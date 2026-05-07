import { existsSync } from 'node:fs';

import { execSafe } from './exec.js';
import { SecretsError } from './errors.js';

export function decryptVaultBlob(privateKeyPath: string, blobPath: string): Record<string, string> {
  if (!existsSync(blobPath)) throw new SecretsError(`vault blob not found: ${blobPath}`);
  if (!existsSync(privateKeyPath)) throw new SecretsError(`private key not found: ${privateKeyPath}`);
  const r = execSafe('age', ['-d', '-i', privateKeyPath, blobPath]);
  if (!r.ok) throw new SecretsError(`age decrypt failed: ${r.stderr}`);
  return parseEnvFormat(r.stdout);
}

function parseEnvFormat(content: string): Record<string, string> {
  const map: Record<string, string> = {};
  for (const rawLine of content.split('\n')) {
    if (!rawLine.trim() || rawLine.startsWith('#')) continue;
    const i = rawLine.indexOf('=');
    if (i > 0) {
      map[rawLine.slice(0, i)] = rawLine.slice(i + 1);
    }
  }
  return map;
}
