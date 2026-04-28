import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, chmodSync, statSync, rmSync, copyFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SecretsError, VaultNotInitializedError } from './errors.js';
import { execSafe } from './exec.js';
import { assertAppName, assertFilePath } from './validate.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const VAULT_DIR = join(__dirname, '..', '..', 'vault');
export const KEY_PATH = '/etc/fleet/age.key';
export const RUNTIME_DIR = '/run/fleet-secrets';
const MANIFEST_PATH = join(VAULT_DIR, 'manifest.json');
const SECRET_DELIMITER = '---SECRET:';

export interface SecretMetadata {
  lastRotated: string;
  provider?: string;
  strategy?: 'immediate' | 'dual-mode' | 'at-rest-key' | 'user-issued';
  notes?: string;
}

export interface ManifestEntry {
  type: 'env' | 'secrets-dir';
  encryptedFile: string;
  sourceFile: string;
  files?: string[];
  lastSealedAt: string;
  keyCount: number;
  /** Per-secret metadata, keyed by secret name. Backwards-compatible: missing means
   * lastRotated falls back to lastSealedAt and provider is auto-classified at read time. */
  secrets?: Record<string, SecretMetadata>;
  /** Per-app age recipient public key, used by harden --per-app to limit blast radius. */
  recipient?: string;
}

export interface Manifest {
  version: number;
  apps: Record<string, ManifestEntry>;
}

export function ensureAge(): void {
  if (!execSafe('which', ['age']).ok) {
    throw new SecretsError('age not found. Install with: apt install age');
  }
}

export function isInitialized(): boolean {
  return existsSync(KEY_PATH) && existsSync(VAULT_DIR);
}

export function isSealed(): boolean {
  return !existsSync(RUNTIME_DIR) || readdirSync(RUNTIME_DIR).length === 0;
}

function requireInit(): void {
  if (!isInitialized()) throw new VaultNotInitializedError();
}

export function getPublicKey(): string {
  requireInit();
  const r = execSafe('age-keygen', ['-y', KEY_PATH]);
  if (!r.ok) throw new SecretsError(`Failed to read public key: ${r.stderr}`);
  return r.stdout;
}

export function initVault(): string {
  ensureAge();
  if (isInitialized()) throw new SecretsError('Vault already initialized');

  const keyDir = '/etc/fleet';
  if (!existsSync(keyDir)) {
    mkdirSync(keyDir, { recursive: true, mode: 0o700 });
  }

  const keygen = execSafe('age-keygen', ['-o', KEY_PATH]);
  if (!keygen.ok) throw new SecretsError(`Failed to generate key: ${keygen.stderr}`);
  chmodSync(KEY_PATH, 0o600);

  if (!existsSync(VAULT_DIR)) {
    mkdirSync(VAULT_DIR, { recursive: true });
  }

  saveManifest({ version: 1, apps: {} });
  return getPublicKey();
}

export function loadManifest(): Manifest {
  requireInit();
  if (!existsSync(MANIFEST_PATH)) return { version: 1, apps: {} };
  try {
    return JSON.parse(readFileSync(MANIFEST_PATH, 'utf-8'));
  } catch {
    return { apps: {} } as Manifest;
  }
}

export function saveManifest(manifest: Manifest): void {
  writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2) + '\n');
}

// Monotonic counter so two backupVaultFile calls in the same millisecond
// (same process, same default-tag path) still produce distinct bak filenames.
let backupSeq = 0;

/**
 * Create a per-op backup of an app's encrypted vault file.
 *
 * Each call produces a unique `.bak-<tag>` path so concurrent operations do
 * not silently overwrite each other's recovery point. If you don't supply a
 * tag, one is generated from PID + timestamp + an in-process monotonic
 * counter. Callers MUST keep the returned path and pass it to
 * `restoreVaultFile` / `removeBackup`.
 */
export function backupVaultFile(app: string, tag?: string): string | null {
  const manifest = loadManifest();
  const entry = manifest.apps[app];
  if (!entry) return null;
  const src = join(VAULT_DIR, entry.encryptedFile);
  if (!existsSync(src)) return null;
  const t = tag ?? `${process.pid}-${Date.now()}-${++backupSeq}`;
  const bak = `${src}.bak-${t}`;
  copyFileSync(src, bak);
  return bak;
}

/**
 * Find the newest `<encryptedFile>.bak-*` for an app, if any. Returns the full
 * path (in VAULT_DIR) or null. Used as a best-effort fallback when no specific
 * backup path was supplied (e.g. the simple CLI / MCP `secrets restore` flow).
 */
function findNewestBackup(encryptedFile: string): string | null {
  if (!existsSync(VAULT_DIR)) return null;
  const prefix = `${encryptedFile}.bak-`;
  let newest: { path: string; mtime: number } | null = null;
  for (const name of readdirSync(VAULT_DIR)) {
    if (!name.startsWith(prefix)) continue;
    const full = join(VAULT_DIR, name);
    try {
      const m = statSync(full).mtimeMs;
      if (!newest || m > newest.mtime) newest = { path: full, mtime: m };
    } catch {
      // ignore stat failures — file may have been removed mid-scan
    }
  }
  return newest ? newest.path : null;
}

export function restoreVaultFile(app: string, bakPath?: string): boolean {
  const manifest = loadManifest();
  const entry = manifest.apps[app];
  if (!entry) return false;
  const src = join(VAULT_DIR, entry.encryptedFile);
  const bak = bakPath ?? findNewestBackup(entry.encryptedFile);
  if (!bak || !existsSync(bak)) return false;
  copyFileSync(bak, src);
  rmSync(bak, { force: true });
  return true;
}

export function removeBackup(app: string, bakPath?: string): void {
  if (bakPath) {
    rmSync(bakPath, { force: true });
    return;
  }
  const manifest = loadManifest();
  const entry = manifest.apps[app];
  if (!entry) return;
  const bak = findNewestBackup(entry.encryptedFile);
  if (bak) rmSync(bak, { force: true });
}

export function ageEncrypt(plaintext: string): string {
  const pubkey = getPublicKey();
  const r = execSafe('age', ['-r', pubkey, '--armor'], { input: plaintext });
  if (!r.ok) throw new SecretsError(`age encrypt failed: ${r.stderr}`);
  return r.stdout;
}

export function ageDecrypt(ciphertext: string | Buffer): string {
  const r = execSafe('age', ['-d', '-i', KEY_PATH], { input: ciphertext.toString() });
  if (!r.ok) throw new SecretsError(`age decrypt failed: ${r.stderr}`);
  return r.stdout;
}

export function ageDecryptFile(filePath: string): string {
  assertFilePath(filePath);
  const r = execSafe('age', ['-d', '-i', KEY_PATH, filePath]);
  if (!r.ok) throw new SecretsError(`age decrypt file failed: ${r.stderr}`);
  return r.stdout;
}

export function sealApp(app: string, envContent: string, sourceFile: string): void {
  requireInit();
  assertAppName(app);
  const encrypted = ageEncrypt(envContent);
  const encFile = `${app}.env.age`;
  writeFileSync(join(VAULT_DIR, encFile), encrypted);

  const keyCount = envContent.split('\n').filter(l => l.includes('=') && !l.startsWith('#')).length;
  const manifest = loadManifest();
  manifest.apps[app] = {
    type: 'env',
    encryptedFile: encFile,
    sourceFile,
    lastSealedAt: new Date().toISOString(),
    keyCount,
  };
  saveManifest(manifest);
}

export function sealDbSecrets(app: string, secretsMap: Record<string, string>, sourceDir: string): void {
  requireInit();
  assertAppName(app);
  const filenames = Object.keys(secretsMap).sort();
  const parts = filenames.map(f => `${SECRET_DELIMITER}${f}---\n${secretsMap[f]}`);
  const bundle = parts.join('\n');
  const encrypted = ageEncrypt(bundle);
  const encFile = `${app}.secrets.age`;
  writeFileSync(join(VAULT_DIR, encFile), encrypted);

  const manifest = loadManifest();
  manifest.apps[app] = {
    type: 'secrets-dir',
    encryptedFile: encFile,
    sourceFile: sourceDir,
    files: filenames,
    lastSealedAt: new Date().toISOString(),
    keyCount: filenames.length,
  };
  saveManifest(manifest);
}

export function decryptApp(app: string): string {
  requireInit();
  const manifest = loadManifest();
  const entry = manifest.apps[app];
  if (!entry) throw new SecretsError(`No secrets found for app: ${app}`);
  return ageDecryptFile(join(VAULT_DIR, entry.encryptedFile));
}

export function parseSecretsBundle(bundle: string): Record<string, string> {
  const files: Record<string, string> = {};
  const parts = bundle.split(SECRET_DELIMITER).filter(p => p.trim());
  for (const part of parts) {
    const delimEnd = part.indexOf('---\n');
    if (delimEnd < 0) continue;
    const filename = part.substring(0, delimEnd);
    const content = part.substring(delimEnd + 4);
    files[filename] = content;
  }
  return files;
}

function maskValue(val: string): string {
  if (val.length <= 3) return '***';
  return val.substring(0, 3) + '***';
}

export function listSecrets(app: string): Array<{ key: string; maskedValue: string }> {
  const plaintext = decryptApp(app);
  const manifest = loadManifest();
  const entry = manifest.apps[app];

  if (entry.type === 'env') {
    return plaintext.split('\n')
      .filter(l => l.includes('=') && !l.startsWith('#') && l.trim())
      .map(line => {
        const eqIdx = line.indexOf('=');
        const key = line.substring(0, eqIdx);
        const val = line.substring(eqIdx + 1);
        return { key, maskedValue: maskValue(val) };
      });
  }

  const files = parseSecretsBundle(plaintext);
  return Object.entries(files).map(([filename, content]) => ({
    key: filename,
    maskedValue: maskValue(content.trim()),
  }));
}
