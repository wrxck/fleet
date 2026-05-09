import { mkdtempSync, writeFileSync, rmSync, chmodSync, existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execSync } from 'node:child_process';
import { createConnection } from 'node:net';

import { describe, it, expect, beforeAll, afterAll } from 'vitest';

import { main } from './secrets-v2.js';

const SKIP = process.env.FLEET_INTEGRATION !== '1';

describe.skipIf(SKIP)('secrets-v2 integration', () => {
  let tmp: string;
  let vaultDir: string;
  let socketPath: string;
  let credPath: string;
  let publicKey: string;
  let agentPromise: Promise<void>;

  beforeAll(async () => {
    tmp = mkdtempSync(join(tmpdir(), 'fleet-v2-int-'));
    vaultDir = join(tmp, 'vault');
    mkdirSync(vaultDir, { recursive: true });
    socketPath = join(tmp, 'agent.sock');
    credPath = join(tmp, 'age.key');

    // generate real age keypair
    const keygen = execSync('age-keygen', { encoding: 'utf-8' });
    const privateKey = keygen.split('\n').filter(l => l.startsWith('AGE-SECRET-KEY-'))[0];
    publicKey = keygen.split('\n').find(l => l.startsWith('# public key: '))!.slice('# public key: '.length).trim();

    writeFileSync(credPath, privateKey + '\n');
    chmodSync(credPath, 0o600);

    // encrypt initial plaintext
    const plaintext = 'KEY1=val1\nKEY2=val2\n';
    const cipher = execSync(`age -r ${publicKey} --armor`, { input: plaintext, encoding: 'utf-8' });
    writeFileSync(join(vaultDir, 'app.env.age'), cipher);

    // launch agent in-process
    agentPromise = main(['--app', 'app', '--vault', vaultDir, '--socket', socketPath, '--credential', credPath]);

    // wait for socket to appear — poll up to 5s
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline && !existsSync(socketPath)) {
      await new Promise(r => setTimeout(r, 100));
    }
    if (!existsSync(socketPath)) throw new Error('agent socket did not appear within 5s');
  }, 30_000);

  afterAll(async () => {
    // emit SIGTERM so main()'s process.once('SIGTERM') handler fires and resolves
    // agentPromise cleanly — safe because main() never calls process.exit()
    try {
      process.emit('SIGTERM');
      await Promise.race([agentPromise, new Promise(r => setTimeout(r, 5000))]);
    } catch { /* ignore */ }
    if (tmp) rmSync(tmp, { recursive: true, force: true });
  });

  async function request(raw: string): Promise<{ status: number; body: string }> {
    return new Promise((resolve, reject) => {
      const sock = createConnection(socketPath);
      const chunks: Buffer[] = [];
      sock.on('connect', () => sock.write(raw));
      sock.on('data', (c: Buffer) => chunks.push(c));
      sock.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf-8');
        const m = text.match(/^HTTP\/1\.1 (\d+)/);
        const status = m ? parseInt(m[1], 10) : -1;
        const bodyStart = text.indexOf('\r\n\r\n');
        const body = bodyStart >= 0 ? text.slice(bodyStart + 4) : '';
        resolve({ status, body });
      });
      sock.on('error', reject);
      sock.setTimeout(2000, () => { sock.destroy(); reject(new Error('timeout')); });
    });
  }

  it('GET /secrets returns the decrypted map', async () => {
    const r = await request('GET /secrets HTTP/1.1\r\nHost: localhost\r\n\r\n');
    expect(r.status).toBe(200);
    expect(JSON.parse(r.body)).toEqual({ KEY1: 'val1', KEY2: 'val2' });
  });

  it('GET /health returns app + secret count', async () => {
    const r = await request('GET /health HTTP/1.1\r\nHost: localhost\r\n\r\n');
    expect(r.status).toBe(200);
    expect(JSON.parse(r.body)).toEqual({ app: 'app', secrets: 2 });
  });

  it('POST /refresh re-decrypts vault blob and returns 200', async () => {
    const r = await request('POST /refresh HTTP/1.1\r\nHost: localhost\r\nContent-Length: 0\r\n\r\n');
    expect(r.status).toBe(200);
    expect(JSON.parse(r.body)).toEqual({ reloaded: true });
  });

  it('refresh picks up vault changes', async () => {
    // mutate vault with new values
    const newPlain = 'KEY1=newval\nKEY3=added\n';
    const newCipher = execSync(`age -r ${publicKey} --armor`, { input: newPlain, encoding: 'utf-8' });
    writeFileSync(join(vaultDir, 'app.env.age'), newCipher);

    // trigger reload
    await request('POST /refresh HTTP/1.1\r\nHost: localhost\r\nContent-Length: 0\r\n\r\n');

    // verify new values
    const r = await request('GET /secrets HTTP/1.1\r\nHost: localhost\r\n\r\n');
    expect(JSON.parse(r.body)).toEqual({ KEY1: 'newval', KEY3: 'added' });
  });
});
