import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, chmodSync, statSync, rmSync, copyFileSync } from 'node:fs';
import { join } from 'node:path';
import { execSync } from 'node:child_process';

import { SecretsError, VaultNotInitializedError } from './errors.js';

export const VAULT_DIR = '/home/matt/fleet/vault';
export const KEY_PATH = '/etc/fleet/age.key';
export const RUNTIME_DIR = '/run/fleet-secrets';
const MANIFEST_PATH = join(VAULT_DIR, 'manifest.json');
const SECRET_DELIMITER = '---SECRET:';

export interface ManifestEntry {
  type: 'env' | 'secrets-dir';
  encryptedFile: string;
  sourceFile: string;
  files?: string[];
  lastSealedAt: string;
  keyCount: number;
}

export interface Manifest {
  version: number;
  apps: Record<string, ManifestEntry>;
}

export function ensureAge(): void {
  try {
    execSync('which age', { stdio: 'pipe' });
  } catch {
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
  return execSync(`age-keygen -y ${KEY_PATH}`, { encoding: 'utf-8' }).trim();
}

export function initVault(): string {
  ensureAge();
  if (isInitialized()) throw new SecretsError('Vault already initialized');

  const keyDir = '/etc/fleet';
  if (!existsSync(keyDir)) {
    mkdirSync(keyDir, { recursive: true, mode: 0o700 });
  }

  execSync(`age-keygen -o ${KEY_PATH} 2>/dev/null`);
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
  return JSON.parse(readFileSync(MANIFEST_PATH, 'utf-8'));
}

export function saveManifest(manifest: Manifest): void {
  writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2) + '\n');
}

export function backupVaultFile(app: string): string | null {
  const manifest = loadManifest();
  const entry = manifest.apps[app];
  if (!entry) return null;
  const src = join(VAULT_DIR, entry.encryptedFile);
  if (!existsSync(src)) return null;
  const bak = src + '.bak';
  copyFileSync(src, bak);
  return bak;
}

export function restoreVaultFile(app: string): boolean {
  const manifest = loadManifest();
  const entry = manifest.apps[app];
  if (!entry) return false;
  const src = join(VAULT_DIR, entry.encryptedFile);
  const bak = src + '.bak';
  if (!existsSync(bak)) return false;
  copyFileSync(bak, src);
  rmSync(bak, { force: true });
  return true;
}

export function removeBackup(app: string): void {
  const manifest = loadManifest();
  const entry = manifest.apps[app];
  if (!entry) return;
  const bak = join(VAULT_DIR, entry.encryptedFile) + '.bak';
  rmSync(bak, { force: true });
}

export function ageEncrypt(plaintext: string): string {
  const pubkey = getPublicKey();
  return execSync(`age -r ${pubkey} --armor`, {
    input: plaintext,
    encoding: 'utf-8',
    maxBuffer: 10 * 1024 * 1024,
  });
}

export function ageDecrypt(ciphertext: string | Buffer): string {
  return execSync(`age -d -i ${KEY_PATH}`, {
    input: ciphertext,
    encoding: 'utf-8',
    maxBuffer: 10 * 1024 * 1024,
  });
}

export function ageDecryptFile(filePath: string): string {
  return execSync(`age -d -i ${KEY_PATH} "${filePath}"`, {
    encoding: 'utf-8',
    maxBuffer: 10 * 1024 * 1024,
  });
}

export function sealApp(app: string, envContent: string, sourceFile: string): void {
  requireInit();
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
