import { execSafe } from './exec';
import { SecretsError } from './errors';
import { scrubSecrets } from './redact';

export interface Keypair {
  publicKey: string;
  privateKey: string;
}

export function reencryptForRecipient(args: {
  ciphertext: string;
  oldKeyPath: string;
  newRecipient: string;
}): string {
  const dec = execSafe('age', ['-d', '-i', args.oldKeyPath], { input: args.ciphertext });
  if (!dec.ok) {
    throw new SecretsError(`decrypt failed: ${scrubSecrets(dec.stderr)}`);
  }
  const plaintext = dec.stdout;
  const enc = execSafe('age', ['-r', args.newRecipient, '--armor'], { input: plaintext });
  if (!enc.ok) {
    throw new SecretsError(`encrypt failed: ${scrubSecrets(enc.stderr)}`);
  }
  return enc.stdout;
}

export function generateKeypair(): Keypair {
  const r = execSafe('age-keygen', []);
  if (!r.ok) throw new SecretsError(`age-keygen failed: ${scrubSecrets(r.stderr)}`);
  const lines = r.stdout.split('\n');
  const pub = lines.find(l => l.startsWith('# public key: '))?.slice('# public key: '.length).trim();
  const priv = lines.find(l => l.startsWith('AGE-SECRET-KEY-'))?.trim();
  if (!pub || !priv) {
    const safeOut = r.stdout
      .split('\n')
      .filter(l => !l.includes('AGE-SECRET-KEY-'))
      .join('\n')
      .slice(0, 200);
    throw new SecretsError(`could not parse age-keygen output: ${safeOut}`);
  }
  return { publicKey: pub, privateKey: priv };
}
