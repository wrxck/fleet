import { existsSync, mkdirSync, chmodSync, unlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { execSafe } from './exec.js';
import { SecretsError } from './errors.js';

export const CRED_DIR = '/etc/fleet/credentials';

export function credentialPathFor(app: string): string {
  return join(CRED_DIR, `${app}.cred`);
}

export function encryptCredential(args: { name: string; plaintext: string; outputPath: string }): void {
  const dir = dirname(args.outputPath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
  const r = execSafe('systemd-creds',
    ['encrypt', '--name', args.name, '-', args.outputPath],
    { input: args.plaintext },
  );
  if (!r.ok) {
    const safeSterr = r.stderr.split(args.plaintext).join('[redacted]');
    throw new SecretsError(`systemd-creds encrypt failed: ${safeSterr}`);
  }
  chmodSync(args.outputPath, 0o600);
}

export function credentialExists(app: string): boolean {
  return existsSync(credentialPathFor(app));
}

export function removeCredential(app: string): void {
  const p = credentialPathFor(app);
  if (existsSync(p)) {
    unlinkSync(p);
  }
}
