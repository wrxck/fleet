import { existsSync, readFileSync, writeFileSync, readdirSync, chmodSync, mkdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { execSync } from 'node:child_process';

import { validateAll } from './secrets-validate.js';
import { SecretsError } from './errors.js';
import {
  KEY_PATH, VAULT_DIR, RUNTIME_DIR,
  loadManifest, saveManifest, decryptApp, parseSecretsBundle,
  sealApp, sealDbSecrets, ageEncrypt, ageDecrypt,
  getPublicKey, isInitialized, isSealed,
} from './secrets.js';

export function setSecret(app: string, key: string, value: string): void {
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

  sealApp(app, updated.join('\n'), entry.sourceFile);
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

export function importEnvFile(app: string, path: string): number {
  if (!existsSync(path)) throw new SecretsError(`File not found: ${path}`);
  const content = readFileSync(path, 'utf-8');
  sealApp(app, content, path);
  const manifest = loadManifest();
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

  sealDbSecrets(app, secretsMap, dir);
  return files.length;
}

export function exportApp(app: string): string {
  return decryptApp(app);
}

export function unsealAll(): void {
  const manifest = loadManifest();

  if (!existsSync(RUNTIME_DIR)) {
    mkdirSync(RUNTIME_DIR, { mode: 0o700, recursive: true });
  }

  for (const [app, entry] of Object.entries(manifest.apps)) {
    const ciphertext = readFileSync(join(VAULT_DIR, entry.encryptedFile), 'utf-8');
    const plaintext = ageDecrypt(ciphertext);

    if (entry.type === 'env') {
      const appDir = join(RUNTIME_DIR, app);
      if (!existsSync(appDir)) mkdirSync(appDir, { recursive: true, mode: 0o700 });
      const envPath = join(appDir, '.env');
      writeFileSync(envPath, plaintext);
      chmodSync(envPath, 0o600);
    } else if (entry.type === 'secrets-dir') {
      const secretsDir = join(RUNTIME_DIR, app, 'secrets');
      if (!existsSync(secretsDir)) mkdirSync(secretsDir, { recursive: true, mode: 0o755 });
      const parsed = parseSecretsBundle(plaintext);
      for (const [filename, content] of Object.entries(parsed)) {
        const fpath = join(secretsDir, filename);
        writeFileSync(fpath, content);
        // 0644: docker compose secrets bind-mounts files into containers where
        // non-root processes (e.g. mongodb uid 999) need read access
        chmodSync(fpath, 0o644);
      }
    }
  }

  // run validation after unseal — fail hard if any secrets are missing
  const results = validateAll();
  let hasMissing = false;
  for (const r of results) {
    if (r.missing.length > 0) {
      process.stderr.write(`[fleet-unseal] ERROR: ${r.app} missing secrets: ${r.missing.join(', ')}\n`);
      hasMissing = true;
    }
  }
  if (hasMissing) {
    throw new SecretsError('Unseal completed but validation failed — some secrets are missing from the vault. Run "fleet secrets validate" for details.');
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
      sealApp(a, content, entry.sourceFile);
    } else {
      const runtimeDir = join(RUNTIME_DIR, a, 'secrets');
      if (!existsSync(runtimeDir)) throw new SecretsError(`Runtime dir not found: ${runtimeDir}`);
      const dirFiles = readdirSync(runtimeDir);
      const secretsMap: Record<string, string> = {};
      for (const f of dirFiles) {
        secretsMap[f] = readFileSync(join(runtimeDir, f), 'utf-8');
      }
      sealDbSecrets(a, secretsMap, entry.sourceFile);
    }
    sealed.push(a);
  }
  return sealed;
}

export function rotateKey(): { oldPubkey: string; newPubkey: string; appsRotated: string[] } {
  const manifest = loadManifest();
  const oldPubkey = getPublicKey();

  const decrypted: Record<string, string> = {};
  for (const [app, entry] of Object.entries(manifest.apps)) {
    const ciphertext = readFileSync(join(VAULT_DIR, entry.encryptedFile), 'utf-8');
    decrypted[app] = ageDecrypt(ciphertext);
  }

  const backupPath = KEY_PATH + '.old';
  execSync(`cp ${KEY_PATH} ${backupPath}`);
  execSync(`age-keygen -o ${KEY_PATH} 2>/dev/null`);
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
