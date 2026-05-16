import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { FleetError } from '../errors';
import { execSafe } from '../exec';

import { backupVaultDir } from './config';

export const AGE_PUB_PATH = process.env.FLEET_BACKUP_AGE_PUB ?? '/etc/fleet/backup.age.pub';
export const AGE_KEY_CRED = process.env.FLEET_BACKUP_AGE_KEY_CRED ?? '/etc/credstore.encrypted/fleet-age-key';
export const UNLOCK_SCRIPT = process.env.FLEET_BACKUP_UNLOCK_SCRIPT ?? '/usr/local/sbin/fleet-unlock-age.sh';

export class UnlockError extends FleetError {}

/** path to the per-app age-encrypted restic password file. */
export function vaultPath(app: string): string {
  return join(backupVaultDir(), `${app}.age`);
}

/** path the running fleet binary points restic at as RESTIC_PASSWORD_COMMAND. */
export function passwordCommandFor(app: string): string {
  return `/usr/local/sbin/fleet-restic-app-key.sh ${app}`;
}

/** returns the age public key (the recipient we encrypt restic passwords to). */
export function readPubKey(): string {
  if (!existsSync(AGE_PUB_PATH)) {
    throw new UnlockError(`age public key not found at ${AGE_PUB_PATH}. run fleet backup init.`);
  }
  const r = execSafe('cat', [AGE_PUB_PATH], { timeout: 2_000 });
  if (!r.ok) throw new UnlockError(`failed reading ${AGE_PUB_PATH}: ${r.stderr}`);
  const pub = r.stdout.trim();
  if (!pub.startsWith('age1')) throw new UnlockError(`malformed age pubkey at ${AGE_PUB_PATH}`);
  return pub;
}

/** generate a random base64 password and age-encrypt it to the vault file. */
export function generateAndStorePassword(app: string): void {
  const dir = backupVaultDir();
  if (!existsSync(dir)) {
    execSafe('mkdir', ['-p', '--mode=700', dir], { timeout: 2_000 });
  }
  const pub = readPubKey();
  // pipe: openssl rand -base64 48 | tr -d \n | age -e -r <pub> > vault
  const out = vaultPath(app);
  const r = execSafe('sh', ['-c', `openssl rand -base64 48 | tr -d '\\n' | age -e -r ${pub} > ${shellEscape(out)} && chmod 600 ${shellEscape(out)}`], { timeout: 10_000 });
  if (!r.ok) throw new UnlockError(`vault write failed: ${r.stderr}`);
}

/** read+decrypt the restic password for an app (held in memory only). */
export function fetchPassword(app: string): string {
  if (!existsSync(vaultPath(app))) {
    throw new UnlockError(`no vault entry for app ${app}. run: fleet backup init ${app}`);
  }
  if (!existsSync(AGE_KEY_CRED)) {
    throw new UnlockError(`age key credential not found at ${AGE_KEY_CRED}. setup incomplete.`);
  }
  const r = execSafe('sh', ['-c', `${shellEscape(UNLOCK_SCRIPT)} | age -d -i /dev/stdin ${shellEscape(vaultPath(app))}`], { timeout: 5_000 });
  if (!r.ok) throw new UnlockError(`password decrypt failed: ${r.stderr}`);
  const pass = r.stdout;
  if (!pass) throw new UnlockError(`decrypted password empty`);
  return pass;
}

function shellEscape(s: string): string {
  return `'${s.replace(/'/g, "'\\''")}'`;
}
