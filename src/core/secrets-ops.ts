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
  lockManifest,
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
//
// safeSealApp / safeSealDbSecrets are the "validate + backup + seal +
// cleanup" primitives. They do NOT take the manifest lock themselves because
// they're called from inside already-locked outer flows (setSecret,
// sealFromRuntime). External callers that need concurrency safety should go
// via setSecret / importEnvFile / importDbSecrets / sealFromRuntime instead;
// those wrap the whole flow in lockManifest().

export function safeSealApp(app: string, content: string, sourceFile: string): SealValidation {
  const validation = validateBeforeSeal(app, content);
  backupVaultFile(app);
  try {
    sealApp(app, content, sourceFile);
    removeBackup(app);
  } catch (err) {
    restoreVaultFile(app);
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
  backupVaultFile(app);
  try {
    sealDbSecrets(app, secretsMap, sourceDir);
    removeBackup(app);
  } catch (err) {
    restoreVaultFile(app);
    throw err;
  }
  return validation;
}

export async function setSecret(
  app: string,
  key: string,
  value: string,
  opts: { allowWeak?: boolean } = {},
): Promise<void> {
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

  // Hold the manifest lock for the entire decrypt → mutate → re-seal cycle so
  // a parallel CLI/cron writer can't insert a stale write between our read
  // and our seal. safeSealApp does its own loadManifest/saveManifest inside —
  // those reads/writes happen under our lock.
  await lockManifest(() => {
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
  });
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

export async function importEnvFile(app: string, path: string): Promise<number> {
  if (!existsSync(path)) throw new SecretsError(`File not found: ${path}`);
  const content = readFileSync(path, 'utf-8');
  return await lockManifest(() => {
    // importEnvFile is an explicit replace — bypass validation, but still backup
    backupVaultFile(app);
    try {
      sealApp(app, content, path);
      removeBackup(app);
    } catch (err) {
      restoreVaultFile(app);
      auditLog({ op: 'import', app, ok: false, details: `${path}: ${err}` });
      throw err;
    }
    const manifest = loadManifest();
    auditLog({ op: 'import', app, ok: true, details: `${path}: ${manifest.apps[app].keyCount} keys` });
    return manifest.apps[app].keyCount;
  });
}

export async function importDbSecrets(app: string, dir: string): Promise<number> {
  if (!existsSync(dir)) throw new SecretsError(`Directory not found: ${dir}`);
  const stat = statSync(dir);
  if (!stat.isDirectory()) throw new SecretsError(`Not a directory: ${dir}`);

  const files = readdirSync(dir).filter(f => !f.startsWith('.'));
  const secretsMap: Record<string, string> = {};
  for (const file of files) {
    secretsMap[file] = readFileSync(join(dir, file), 'utf-8');
  }

  return await lockManifest(() => {
    // importDbSecrets is an explicit replace — bypass validation, but still backup
    backupVaultFile(app);
    try {
      sealDbSecrets(app, secretsMap, dir);
      removeBackup(app);
    } catch (err) {
      restoreVaultFile(app);
      throw err;
    }
    return files.length;
  });
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

export async function sealFromRuntime(app?: string): Promise<string[]> {
  return await lockManifest(() => {
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
  });
}

export async function rotateKey(): Promise<{ oldPubkey: string; newPubkey: string; appsRotated: string[] }> {
  return await lockManifest(() => {
    const manifest = loadManifest();
    const oldPubkey = getPublicKey();

    const decrypted: Record<string, string> = {};
    for (const [app, entry] of Object.entries(manifest.apps)) {
      decrypted[app] = ageDecryptFile(join(VAULT_DIR, entry.encryptedFile));
    }

    const backupPath = KEY_PATH + '.old';
    copyFileSync(KEY_PATH, backupPath);
    const keygen = execSafe('age-keygen', ['-o', KEY_PATH]);
    if (!keygen.ok) throw new SecretsError(`Failed to generate new key: ${keygen.stderr}`);
    chmodSync(KEY_PATH, 0o600);
    const newPubkey = getPublicKey();

    for (const [app, entry] of Object.entries(manifest.apps)) {
      const encrypted = ageEncrypt(decrypted[app]);
      writeFileSync(join(VAULT_DIR, entry.encryptedFile), encrypted);
      entry.lastSealedAt = new Date().toISOString();
    }
    saveManifest(manifest);

    rmSync(backupPath, { force: true });

    return { oldPubkey, newPubkey, appsRotated: Object.keys(manifest.apps) };
  });
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
