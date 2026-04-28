import { existsSync, readFileSync, writeFileSync, readdirSync, chmodSync, mkdirSync, rmSync, statSync, copyFileSync } from 'node:fs';
import { join, basename } from 'node:path';
import { timingSafeEqual } from 'node:crypto';

import { validateAll } from './secrets-validate.js';
import { execSafe } from './exec.js';
import { assertAppName, assertFilePath, assertSecretKey } from './validate.js';
import { SecretsError } from './errors.js';
import { auditLog } from './secrets-audit.js';
import { checkEntropy } from './secrets-rotation.js';
import { chownSync } from 'node:fs';
import { load as loadRegistry } from './registry.js';

/**
 * Best-effort UID/GID tightening of a runtime secrets file. If the registry
 * defines runtimeUid/runtimeGid for the app, chown to those values; otherwise
 * leave as-is (root:root). Never throws — secret availability beats stricter
 * perms (we already chmod'd 0600 so root-only is the floor).
 */
function tryTightenPerms(envPath: string, app: string): void {
  try {
    const reg = loadRegistry();
    const entry = reg.apps.find(a => a.name === app);
    if (!entry?.runtimeUid && !entry?.runtimeGid) return;
    chownSync(envPath, entry.runtimeUid ?? 0, entry.runtimeGid ?? 0);
  } catch (err) {
    // log + continue; never block unseal
    process.stderr.write(`[fleet-unseal] perm tightening skipped for ${app}: ${err}\n`);
  }
}
import {
  KEY_PATH, VAULT_DIR, RUNTIME_DIR,
  loadManifest, saveManifest, decryptApp, parseSecretsBundle,
  sealApp, sealDbSecrets, ageEncrypt, ageDecryptFile,
  getPublicKey, isInitialized, isSealed,
  backupVaultFile, restoreVaultFile, removeBackup,
} from './secrets.js';

// --- helpers ---

function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

function parseEnvKeys(content: string): string[] {
  return content.split('\n')
    .filter(l => l.includes('=') && !l.startsWith('#') && l.trim())
    .map(l => l.substring(0, l.indexOf('=')));
}

// --- Phase 2: Pre-seal key validation ---

export interface SealValidation {
  added: string[];
  removed: string[];
  unchanged: string[];
}

export function validateBeforeSeal(app: string, newContent: string): SealValidation {
  const manifest = loadManifest();
  const entry = manifest.apps[app];

  // New app — no previous data to compare
  if (!entry) return { added: parseEnvKeys(newContent), removed: [], unchanged: [] };

  const oldPlaintext = decryptApp(app);

  let oldKeys: string[];
  let newKeys: string[];

  if (entry.type === 'env') {
    oldKeys = parseEnvKeys(oldPlaintext);
    newKeys = parseEnvKeys(newContent);
  } else {
    oldKeys = Object.keys(parseSecretsBundle(oldPlaintext));
    newKeys = Object.keys(parseSecretsBundle(newContent));
  }

  const oldSet = new Set(oldKeys);
  const newSet = new Set(newKeys);

  const added = newKeys.filter(k => !oldSet.has(k));
  const removed = oldKeys.filter(k => !newSet.has(k));
  const unchanged = oldKeys.filter(k => newSet.has(k));

  // Reject if >50% of keys would be dropped (protects against accidental wipes)
  if (oldKeys.length > 0 && removed.length > oldKeys.length * 0.5) {
    throw new SecretsError(
      `Seal rejected for ${app}: would remove ${removed.length}/${oldKeys.length} keys (${removed.join(', ')}). ` +
      `This looks like an accidental wipe. Use importEnvFile to force-replace.`
    );
  }

  return { added, removed, unchanged };
}

// --- Phase 8: Safe seal wrappers ---

export function safeSealApp(app: string, content: string, sourceFile: string): SealValidation {
  const validation = validateBeforeSeal(app, content);
  const bak = backupVaultFile(app);
  try {
    sealApp(app, content, sourceFile);
    if (bak) removeBackup(app, bak);
  } catch (err) {
    if (bak) restoreVaultFile(app, bak);
    throw err;
  }
  return validation;
}

export function safeSealDbSecrets(app: string, secretsMap: Record<string, string>, sourceDir: string): SealValidation {
  // Build the bundle content for validation
  const SECRET_DELIMITER = '---SECRET:';
  const filenames = Object.keys(secretsMap).sort();
  const parts = filenames.map(f => `${SECRET_DELIMITER}${f}---\n${secretsMap[f]}`);
  const bundleContent = parts.join('\n');

  const validation = validateBeforeSeal(app, bundleContent);
  const bak = backupVaultFile(app);
  try {
    sealDbSecrets(app, secretsMap, sourceDir);
    if (bak) removeBackup(app, bak);
  } catch (err) {
    if (bak) restoreVaultFile(app, bak);
    throw err;
  }
  return validation;
}

export function setSecret(
  app: string,
  key: string,
  value: string,
  opts: { allowWeak?: boolean } = {},
): void {
  assertAppName(app);
  assertSecretKey(key);

  // Entropy / placeholder check unless explicitly bypassed.
  if (!opts.allowWeak) {
    const entropyErr = checkEntropy(value);
    if (entropyErr) {
      auditLog({ op: 'set', app, secret: key, ok: false, details: `weak value rejected: ${entropyErr}` });
      throw new SecretsError(
        `${entropyErr}. Pass --allow-weak to override (not recommended).`,
      );
    }
  }

  const plaintext = decryptApp(app);
  const manifest = loadManifest();
  const entry = manifest.apps[app];
  if (entry.type !== 'env') throw new SecretsError(`Cannot set key/value on secrets-dir type for ${app}`);

  const lines = plaintext.split('\n');
  let found = false;
  const updated = lines.map(line => {
    const eqIdx = line.indexOf('=');
    if (eqIdx > 0 && line.substring(0, eqIdx) === key) {
      found = true;
      return `${key}=${value}`;
    }
    return line;
  });
  if (!found) updated.push(`${key}=${value}`);

  safeSealApp(app, updated.join('\n'), entry.sourceFile);
  auditLog({ op: 'set', app, secret: key, ok: true });
}

export function getSecret(app: string, key: string): string | null {
  const plaintext = decryptApp(app);
  const manifest = loadManifest();
  const entry = manifest.apps[app];

  if (entry.type === 'env') {
    for (const line of plaintext.split('\n')) {
      const eqIdx = line.indexOf('=');
      if (eqIdx > 0 && line.substring(0, eqIdx) === key) {
        return line.substring(eqIdx + 1);
      }
    }
    return null;
  }

  const files = parseSecretsBundle(plaintext);
  return files[key] ?? null;
}

// Note: getSecret is read-only; we audit at the command layer to record
// human-driven reads (set/get/import/export). Programmatic reads done by
// other fleet operations (sealing, validation, drift) are not audited to
// avoid log noise.

export function importEnvFile(app: string, path: string): number {
  if (!existsSync(path)) throw new SecretsError(`File not found: ${path}`);
  const content = readFileSync(path, 'utf-8');
  // importEnvFile is an explicit replace — bypass validation, but still backup
  const bak = backupVaultFile(app);
  try {
    sealApp(app, content, path);
    if (bak) removeBackup(app, bak);
  } catch (err) {
    if (bak) restoreVaultFile(app, bak);
    auditLog({ op: 'import', app, ok: false, details: `${path}: ${err}` });
    throw err;
  }
  const manifest = loadManifest();
  auditLog({ op: 'import', app, ok: true, details: `${path}: ${manifest.apps[app].keyCount} keys` });
  return manifest.apps[app].keyCount;
}

export function importDbSecrets(app: string, dir: string): number {
  if (!existsSync(dir)) throw new SecretsError(`Directory not found: ${dir}`);
  const stat = statSync(dir);
  if (!stat.isDirectory()) throw new SecretsError(`Not a directory: ${dir}`);

  const files = readdirSync(dir).filter(f => !f.startsWith('.'));
  const secretsMap: Record<string, string> = {};
  for (const file of files) {
    secretsMap[file] = readFileSync(join(dir, file), 'utf-8');
  }

  // importDbSecrets is an explicit replace — bypass validation, but still backup
  const bak = backupVaultFile(app);
  try {
    sealDbSecrets(app, secretsMap, dir);
    if (bak) removeBackup(app, bak);
  } catch (err) {
    if (bak) restoreVaultFile(app, bak);
    throw err;
  }
  return files.length;
}

export function exportApp(app: string): string {
  auditLog({ op: 'export', app, ok: true });
  return decryptApp(app);
}

// --- Phase 3: Drift detection ---

export interface DriftResult {
  app: string;
  status: 'in-sync' | 'drifted' | 'missing-runtime';
  addedKeys: string[];
  removedKeys: string[];
  changedKeys: string[];
}

export function detectDrift(app?: string): DriftResult[] {
  const manifest = loadManifest();
  const apps = app ? [app] : Object.keys(manifest.apps);
  const results: DriftResult[] = [];

  for (const a of apps) {
    const entry = manifest.apps[a];
    if (!entry) {
      results.push({ app: a, status: 'missing-runtime', addedKeys: [], removedKeys: [], changedKeys: [] });
      continue;
    }

    if (entry.type === 'env') {
      const runtimePath = join(RUNTIME_DIR, a, '.env');
      if (!existsSync(runtimePath)) {
        results.push({ app: a, status: 'missing-runtime', addedKeys: [], removedKeys: [], changedKeys: [] });
        continue;
      }

      const vaultPlaintext = decryptApp(a);
      const runtimeContent = readFileSync(runtimePath, 'utf-8');

      const vaultMap = parseEnvMap(vaultPlaintext);
      const runtimeMap = parseEnvMap(runtimeContent);

      const addedKeys = Object.keys(runtimeMap).filter(k => !(k in vaultMap));
      const removedKeys = Object.keys(vaultMap).filter(k => !(k in runtimeMap));
      const changedKeys = Object.keys(vaultMap).filter(k => k in runtimeMap && !safeEqual(vaultMap[k], runtimeMap[k]));

      const status = (addedKeys.length || removedKeys.length || changedKeys.length) ? 'drifted' : 'in-sync';
      results.push({ app: a, status, addedKeys, removedKeys, changedKeys });
    } else {
      const runtimeDir = join(RUNTIME_DIR, a, 'secrets');
      if (!existsSync(runtimeDir)) {
        results.push({ app: a, status: 'missing-runtime', addedKeys: [], removedKeys: [], changedKeys: [] });
        continue;
      }

      const vaultPlaintext = decryptApp(a);
      const vaultFiles = parseSecretsBundle(vaultPlaintext);
      const runtimeFiles = readdirSync(runtimeDir);
      const runtimeMap: Record<string, string> = {};
      for (const f of runtimeFiles) {
        runtimeMap[f] = readFileSync(join(runtimeDir, f), 'utf-8');
      }

      const addedKeys = runtimeFiles.filter(f => !(f in vaultFiles));
      const removedKeys = Object.keys(vaultFiles).filter(f => !(f in runtimeMap));
      const changedKeys = Object.keys(vaultFiles).filter(f => f in runtimeMap && !safeEqual(vaultFiles[f], runtimeMap[f]));

      const status = (addedKeys.length || removedKeys.length || changedKeys.length) ? 'drifted' : 'in-sync';
      results.push({ app: a, status, addedKeys, removedKeys, changedKeys });
    }
  }

  return results;
}

function parseEnvMap(content: string): Record<string, string> {
  const map: Record<string, string> = {};
  for (const line of content.split('\n')) {
    if (!line.trim() || line.startsWith('#')) continue;
    const eqIdx = line.indexOf('=');
    if (eqIdx > 0) {
      map[line.substring(0, eqIdx)] = line.substring(eqIdx + 1);
    }
  }
  return map;
}

// --- Phase 4: Improved unseal (validate before write) ---

export function unsealAll(): void {
  const manifest = loadManifest();
  auditLog({ op: 'unseal', ok: true, details: `apps=${Object.keys(manifest.apps).length}` });

  // Phase 4: Decrypt all apps first and validate BEFORE writing to runtime
  const decrypted: Record<string, string> = {};
  for (const [app, entry] of Object.entries(manifest.apps)) {
    decrypted[app] = ageDecryptFile(join(VAULT_DIR, entry.encryptedFile));
  }

  // Validate before writing — catch missing secrets before runtime gets partial data
  const results = validateAll();
  let hasMissing = false;
  for (const r of results) {
    if (r.missing.length > 0) {
      process.stderr.write(`[fleet-unseal] ERROR: ${r.app} missing secrets: ${r.missing.join(', ')}\n`);
      hasMissing = true;
    }
  }
  if (hasMissing) {
    throw new SecretsError('Unseal aborted — some secrets are missing from the vault. Runtime was NOT modified. Run "fleet secrets validate" for details.');
  }

  // All valid — now write to runtime
  if (!existsSync(RUNTIME_DIR)) {
    mkdirSync(RUNTIME_DIR, { mode: 0o700, recursive: true });
  }

  for (const [app, entry] of Object.entries(manifest.apps)) {
    const plaintext = decrypted[app];

    if (entry.type === 'env') {
      const appDir = join(RUNTIME_DIR, app);
      if (!existsSync(appDir)) mkdirSync(appDir, { recursive: true, mode: 0o700 });
      const envPath = join(appDir, '.env');
      writeFileSync(envPath, plaintext);
      chmodSync(envPath, 0o600);
      // Optional UID/GID tightening (registry.runtimeUid/runtimeGid). Default
      // root:root if unset. Failures are non-fatal — if the UID doesn't exist
      // we'd rather have the secret available than fail boot.
      tryTightenPerms(envPath, app);
    } else if (entry.type === 'secrets-dir') {
      const secretsDir = join(RUNTIME_DIR, app, 'secrets');
      if (!existsSync(secretsDir)) mkdirSync(secretsDir, { recursive: true, mode: 0o700 });
      const parsed = parseSecretsBundle(plaintext);
      for (const [filename, content] of Object.entries(parsed)) {
        const safe = basename(filename);
        if (safe !== filename || filename.includes('..')) {
          throw new SecretsError(`Invalid secret filename: ${filename}`);
        }
        const fpath = join(secretsDir, safe);
        writeFileSync(fpath, content);
        // 0644: docker bind-mounts these files into containers where non-root
        // processes need read access. group-only (0640) breaks mongo's
        // entrypoint, which reads the password file as uid 999 (mongodb)
        // without first reading as root the way postgres does. host security
        // still relies on the parent dir being 0700 root:root, so 0644 here
        // does not widen host exposure.
        chmodSync(fpath, 0o644);
      }
    }
  }
}

export function sealFromRuntime(app?: string): string[] {
  const manifest = loadManifest();
  const apps = app ? [app] : Object.keys(manifest.apps);
  const sealed: string[] = [];

  for (const a of apps) {
    const entry = manifest.apps[a];
    if (!entry) throw new SecretsError(`No secrets found for app: ${a}`);

    if (entry.type === 'env') {
      const runtimePath = join(RUNTIME_DIR, a, '.env');
      if (!existsSync(runtimePath)) throw new SecretsError(`Runtime file not found: ${runtimePath}`);
      const content = readFileSync(runtimePath, 'utf-8');
      safeSealApp(a, content, entry.sourceFile);
    } else {
      const runtimeDir = join(RUNTIME_DIR, a, 'secrets');
      if (!existsSync(runtimeDir)) throw new SecretsError(`Runtime dir not found: ${runtimeDir}`);
      const dirFiles = readdirSync(runtimeDir);
      const secretsMap: Record<string, string> = {};
      for (const f of dirFiles) {
        secretsMap[f] = readFileSync(join(runtimeDir, f), 'utf-8');
      }
      safeSealDbSecrets(a, secretsMap, entry.sourceFile);
    }
    sealed.push(a);
  }
  return sealed;
}

/**
 * Rotate the age private key and re-encrypt every app's vault file with it.
 *
 * RECOVERY PROCEDURE (manual, only if rollback itself fails):
 *   1. The previous private key is preserved at `<KEY_PATH>.old` while a
 *      rotation is in flight. If you see that file lying around, a rotation
 *      crashed mid-way.
 *   2. Each app's pre-rotate encrypted file is preserved as
 *      `vault/<app>.{env,secrets}.age.bak-rotate-<ts>` for the duration of
 *      the rotation. They are removed automatically on success OR after a
 *      successful rollback.
 *   3. To restore by hand: copy `<KEY_PATH>.old` back to `<KEY_PATH>`
 *      (chmod 0600), then for each `*.bak-rotate-<ts>` copy it over the
 *      matching encrypted file. This puts the vault back into the
 *      pre-rotation state.
 *
 * On a partial-failure path inside this function, that recovery is performed
 * automatically before re-throwing.
 */
export function rotateKey(): { oldPubkey: string; newPubkey: string; appsRotated: string[] } {
  const manifest = loadManifest();
  const oldPubkey = getPublicKey();

  // 1. Decrypt all apps with the OLD key (still on disk at KEY_PATH).
  const decrypted: Record<string, string> = {};
  for (const [app, entry] of Object.entries(manifest.apps)) {
    decrypted[app] = ageDecryptFile(join(VAULT_DIR, entry.encryptedFile));
  }

  // 2. Backup the old key so we can roll back if anything below throws.
  const backupPath = KEY_PATH + '.old';
  copyFileSync(KEY_PATH, backupPath);

  // 3. Generate the new key in place. If keygen fails BEFORE we've mutated
  //    any vault file, the old key on disk is still good — clean up the
  //    sidecar backup and bail without touching the vault.
  const keygen = execSafe('age-keygen', ['-o', KEY_PATH]);
  if (!keygen.ok) {
    rmSync(backupPath, { force: true });
    throw new SecretsError(`Failed to generate new key: ${keygen.stderr}`);
  }
  chmodSync(KEY_PATH, 0o600);
  const newPubkey = getPublicKey();

  // 4. Snapshot every app's CURRENT (still old-key-encrypted) vault file
  //    BEFORE we start rewriting anything. Same rotation tag for all of them
  //    so a human can grep for `bak-rotate-<ts>` if they need to recover.
  const rotateTag = `rotate-${Date.now()}`;
  const backups: Array<{ app: string; bak: string }> = [];

  try {
    for (const app of Object.keys(manifest.apps)) {
      const b = backupVaultFile(app, rotateTag);
      if (b) backups.push({ app, bak: b });
    }

    // 5. Re-encrypt each app's plaintext under the NEW key and overwrite
    //    its vault file. If any encryption or write throws partway through,
    //    we land in the catch block below.
    for (const [app, entry] of Object.entries(manifest.apps)) {
      const encrypted = ageEncrypt(decrypted[app]);
      writeFileSync(join(VAULT_DIR, entry.encryptedFile), encrypted);
      entry.lastSealedAt = new Date().toISOString();
    }
    saveManifest(manifest);

    // 6. Success — drop the per-app rotation backups and the old-key sidecar.
    for (const b of backups) rmSync(b.bak, { force: true });
    rmSync(backupPath, { force: true });
  } catch (err) {
    // Rollback: put the old key back, then restore every vault file from the
    // matching pre-rotate backup. If rollback itself fails we deliberately
    // leak the .bak-rotate-* files and KEY_PATH.old so a human has the
    // pieces needed to recover by hand (see comment at top of function).
    try {
      copyFileSync(backupPath, KEY_PATH);
      chmodSync(KEY_PATH, 0o600);
      for (const b of backups) {
        const entry = manifest.apps[b.app];
        if (!entry) continue;
        copyFileSync(b.bak, join(VAULT_DIR, entry.encryptedFile));
      }
    } catch (rollbackErr) {
      throw new SecretsError(
        `rotateKey failed AND rollback failed: ${(err as Error).message}; ` +
        `rollback: ${(rollbackErr as Error).message}; ` +
        `manual recovery needed (KEY_PATH.old + vault/*.bak-${rotateTag} files preserved)`
      );
    }
    // Rollback succeeded — vault is back where it started under the old key.
    // Safe to clean up the per-app backups and the old-key sidecar.
    for (const b of backups) rmSync(b.bak, { force: true });
    rmSync(backupPath, { force: true });
    throw new SecretsError(`rotateKey failed (rolled back): ${(err as Error).message}`);
  }

  return { oldPubkey, newPubkey, appsRotated: Object.keys(manifest.apps) };
}

export function getStatus(): {
  initialized: boolean;
  sealed: boolean;
  keyPath: string;
  vaultDir: string;
  runtimeDir: string;
  appCount: number;
  totalKeys: number;
} {
  const init = isInitialized();
  let appCount = 0;
  let totalKeys = 0;

  if (init) {
    const manifest = loadManifest();
    appCount = Object.keys(manifest.apps).length;
    totalKeys = Object.values(manifest.apps).reduce((sum, e) => sum + e.keyCount, 0);
  }

  return {
    initialized: init,
    sealed: isSealed(),
    keyPath: KEY_PATH,
    vaultDir: VAULT_DIR,
    runtimeDir: RUNTIME_DIR,
    appCount,
    totalKeys,
  };
}
