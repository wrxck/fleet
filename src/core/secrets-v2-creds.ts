import { existsSync, mkdirSync, chmodSync, unlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { execSafe } from './exec';
import { SecretsError } from './errors';

export const CRED_DIR = '/etc/fleet/credentials';

export function credentialPathFor(app: string): string {
  const p = join(CRED_DIR, `${app}.cred`);
  if (!p.startsWith(CRED_DIR + '/')) {
    throw new SecretsError(`invalid app name: ${app}`);
  }
  return p;
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
    const safeStderr = args.plaintext.length > 0
      ? r.stderr.split(args.plaintext).join('[redacted]')
      : r.stderr;
    throw new SecretsError(`systemd-creds encrypt failed: ${safeStderr}`);
  }
  try {
    chmodSync(args.outputPath, 0o600);
  } catch (chmodErr) {
    try { unlinkSync(args.outputPath); } catch { /* ignore */ }
    throw new SecretsError(`chmod failed for ${args.outputPath}: ${(chmodErr as Error).message}`);
  }
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
