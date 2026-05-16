import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { requireEnv } from '../env';
import { FleetError } from '../errors';
import { execSafe } from '../exec';

import { backupVaultDir } from './config';

/** absolute path to the age recipient public key. */
export function agePubPath(): string { return requireEnv('FLEET_BACKUP_AGE_PUB'); }
/** systemd credstore entry holding the age identity. */
export function ageKeyCred(): string { return requireEnv('FLEET_BACKUP_AGE_KEY_CRED'); }
/** absolute path to the age unlock helper script. */
export function unlockScript(): string { return requireEnv('FLEET_BACKUP_UNLOCK_SCRIPT'); }

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
  const pubPath = agePubPath();
  if (!existsSync(pubPath)) {
    throw new UnlockError(`age public key not found at ${pubPath}. run fleet backup init.`);
  }
  const r = execSafe('cat', [pubPath], { timeout: 2_000 });
  if (!r.ok) throw new UnlockError(`failed reading ${pubPath}: ${r.stderr}`);
  const pub = r.stdout.trim();
  if (!pub.startsWith('age1')) throw new UnlockError(`malformed age pubkey at ${pubPath}`);
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
  const keyCred = ageKeyCred();
  if (!existsSync(keyCred)) {
    throw new UnlockError(`age key credential not found at ${keyCred}. setup incomplete.`);
  }
  const r = execSafe('sh', ['-c', `${shellEscape(unlockScript())} | age -d -i /dev/stdin ${shellEscape(vaultPath(app))}`], { timeout: 5_000 });
  if (!r.ok) throw new UnlockError(`password decrypt failed: ${r.stderr}`);
  const pass = r.stdout;
  if (!pass) throw new UnlockError(`decrypted password empty`);
  return pass;
}

function shellEscape(s: string): string {
  return `'${s.replace(/'/g, "'\\''")}'`;
}
