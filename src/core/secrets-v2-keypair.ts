import { execSafe } from './exec.js';
import { SecretsError } from './errors.js';

export interface Keypair {
  publicKey: string;
  privateKey: string;
}

export function generateKeypair(): Keypair {
  const r = execSafe('age-keygen', []);
  if (!r.ok) throw new SecretsError(`age-keygen failed: ${r.stderr}`);
  const lines = r.stdout.split('\n');
  const pub = lines.find(l => l.startsWith('# public key: '))?.slice('# public key: '.length).trim();
  const priv = lines.find(l => l.startsWith('AGE-SECRET-KEY-'))?.trim();
  if (!pub || !priv) {
    throw new SecretsError(`could not parse age-keygen output: ${r.stdout.slice(0, 100)}`);
  }
  return { publicKey: pub, privateKey: priv };
}
