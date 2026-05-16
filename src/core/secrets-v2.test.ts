import { existsSync, statSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createConnection } from 'node:net';

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { execSafe } from './exec.js';
import type { ExecResult } from './exec.js';
import { SecretsError } from './errors.js';
import { decryptVaultBlob, createServer as createAgentServer, type AgentDeps, _resetRateLimit, IDLE_TIMEOUT_MS, parseArgs, main } from './secrets-v2.js';

// partial mock: spread real node:fs but stub existsSync; real impl exposed as __realExistsSync
vi.mock('node:fs', async (importOriginal) => {
  const real = await importOriginal<typeof import('node:fs')>();
  const stub = vi.fn(real.existsSync);
  return { ...real, existsSync: stub, __realExistsSync: real.existsSync };
});
vi.mock('./exec.js', () => ({ execSafe: vi.fn() }));

const ok = (stdout: string): ExecResult => ({ ok: true, stdout, stderr: '', exitCode: 0 });
const fail = (stderr: string): ExecResult => ({ ok: false, stdout: '', stderr, exitCode: 1 });

describe('decryptVaultBlob', () => {
  beforeEach(() => {
    vi.mocked(execSafe).mockReset();
    vi.mocked(existsSync).mockReset();
  });

  it('happy path: returns parsed key=value map', () => {
    vi.mocked(existsSync)
      .mockReturnValueOnce(true)  // blobPath
      .mockReturnValueOnce(true); // privateKeyPath
    vi.mocked(execSafe).mockReturnValueOnce(
      ok('STRIPE_KEY=sk_test_abc\nDATABASE_URL=postgres://x\n'),
    );
    const result = decryptVaultBlob('/run/credentials/myapp/age-key', '/var/lib/fleet/myapp.age');
    expect(result).toEqual({ STRIPE_KEY: 'sk_test_abc', DATABASE_URL: 'postgres://x' });
  });

  it('throws SecretsError containing "vault blob not found" when blob is missing', () => {
    vi.mocked(existsSync).mockReturnValueOnce(false); // blobPath missing
    expect(() =>
      decryptVaultBlob('/run/credentials/myapp/age-key', '/var/lib/fleet/myapp.age'),
    ).toThrow(/vault blob not found/);
    expect(vi.mocked(execSafe)).not.toHaveBeenCalled();
  });

  it('throws SecretsError containing "private key not found" when key file is missing', () => {
    vi.mocked(existsSync)
      .mockReturnValueOnce(true)   // blobPath exists
      .mockReturnValueOnce(false); // privateKeyPath missing
    expect(() =>
      decryptVaultBlob('/run/credentials/myapp/age-key', '/var/lib/fleet/myapp.age'),
    ).toThrow(/private key not found/);
    expect(vi.mocked(execSafe)).not.toHaveBeenCalled();
  });

  it('throws SecretsError with "age decrypt failed" when execSafe returns ok=false', () => {
    vi.mocked(existsSync)
      .mockReturnValueOnce(true)
      .mockReturnValueOnce(true);
    vi.mocked(execSafe).mockReturnValueOnce(fail('no matching keys'));
    expect(() =>
      decryptVaultBlob('/run/credentials/myapp/age-key', '/var/lib/fleet/myapp.age'),
    ).toThrow(/age decrypt failed/);
  });

  it('calls execSafe with exactly the expected arguments', () => {
    const privateKeyPath = '/run/credentials/myapp/age-key';
    const blobPath = '/var/lib/fleet/myapp.age';
    vi.mocked(existsSync).mockReturnValueOnce(true).mockReturnValueOnce(true);
    vi.mocked(execSafe).mockReturnValueOnce(ok('FOO=bar\n'));
    decryptVaultBlob(privateKeyPath, blobPath);
    expect(vi.mocked(execSafe)).toHaveBeenCalledOnce();
    const call = vi.mocked(execSafe).mock.calls[0];
    expect(call[0]).toBe('age');
    expect(call[1]).toEqual(['-d', '-i', privateKeyPath, blobPath]);
    expect(call[2]).toBeUndefined();
  });

  it('preserves empty values: EMPTY= gives empty string', () => {
    vi.mocked(existsSync).mockReturnValueOnce(true).mockReturnValueOnce(true);
    vi.mocked(execSafe).mockReturnValueOnce(ok('EMPTY=\nNORMAL=value\n'));
    const result = decryptVaultBlob('/run/credentials/myapp/age-key', '/var/lib/fleet/myapp.age');
    expect(result).toEqual({ EMPTY: '', NORMAL: 'value' });
  });

  it('skips comment lines and blank lines', () => {
    vi.mocked(existsSync).mockReturnValueOnce(true).mockReturnValueOnce(true);
    vi.mocked(execSafe).mockReturnValueOnce(ok('# comment\nFOO=bar\n# another\n'));
    const result = decryptVaultBlob('/run/credentials/myapp/age-key', '/var/lib/fleet/myapp.age');
    expect(result).toEqual({ FOO: 'bar' });
  });

  it('preserves = signs in values (base64 padding etc)', () => {
    vi.mocked(existsSync).mockReturnValueOnce(true).mockReturnValueOnce(true);
    vi.mocked(execSafe).mockReturnValueOnce(ok('TOKEN=eyJ=base64=padding==\n'));
    const result = decryptVaultBlob('/run/credentials/myapp/age-key', '/var/lib/fleet/myapp.age');
    expect(result).toEqual({ TOKEN: 'eyJ=base64=padding==' });
  });

  it('plaintext-leak guard: error message does not include private key path', () => {
    const privateKeyPath = '/run/credentials/myapp/age-key';
    const blobPath = '/var/lib/fleet/myapp.age';
    // synthetic stderr with key material -- age never actually emits this; regression guard only
    const stderrWithKey = 'AGE-SECRET-KEY-1SYNTHETIC_KEY_IN_STDERR: decryption failed';
    vi.mocked(existsSync).mockReturnValueOnce(true).mockReturnValueOnce(true);
    vi.mocked(execSafe).mockReturnValueOnce(fail(stderrWithKey));
    let caught: SecretsError | null = null;
    try {
      decryptVaultBlob(privateKeyPath, blobPath);
    } catch (e) {
      caught = e as SecretsError;
    }
    expect(caught).not.toBeNull();
    expect(caught).toBeInstanceOf(SecretsError);
    expect(caught!.message).toContain('age decrypt failed');
    // the private key path itself must never appear in the error message
    expect(caught!.message).not.toContain(privateKeyPath);
  });
});

// socket server tests

function makeDeps(overrides: Partial<AgentDeps> = {}): AgentDeps {
  return {
    app: 'testapp',
    getSecrets: () => ({}),
    refresh: () => {},
    ...overrides,
  };
}

async function request(socketPath: string, raw: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const sock = createConnection(socketPath);
    const chunks: Buffer[] = [];
    sock.on('connect', () => sock.write(raw));
    sock.on('data', (c: Buffer) => chunks.push(c));
    sock.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
    sock.on('error', reject);
    sock.setTimeout(2000, () => { sock.destroy(); reject(new Error('timeout')); });
  });
}

describe('createServer (socket server)', () => {
  let tmpDir: string;
  let socketPath: string;
  let server: ReturnType<typeof createAgentServer>;

  beforeEach(() => {
    // pass through to real existsSync for server tests (no mock behaviour needed)
    vi.mocked(existsSync).mockReset();
    // default implementation: call through to the real function
    vi.mocked(existsSync).mockImplementation(
      (p: Parameters<typeof existsSync>[0]) => statSync(p as string, { throwIfNoEntry: false }) !== undefined,
    );
    tmpDir = mkdtempSync(join(tmpdir(), 'fleet-v2-svr-test-'));
    socketPath = join(tmpDir, 'agent.sock');
    server = createAgentServer(makeDeps());
  });

  afterEach(async () => {
    await server.close();
    rmSync(tmpDir, { recursive: true, force: true });
    vi.mocked(existsSync).mockReset();
  });

  it('listen creates socket file', async () => {
    await server.listen(socketPath);
    expect(existsSync(socketPath)).toBe(true);
  });

  it('socket file mode is 0660', async () => {
    await server.listen(socketPath);
    const mode = statSync(socketPath).mode & 0o777;
    expect(mode).toBe(0o660);
  });

  it('close unlinks socket file', async () => {
    await server.listen(socketPath);
    await server.close();
    expect(existsSync(socketPath)).toBe(false);
  });

  it('listen replaces stale socket file', async () => {
    // pre-create a regular file at the socket path to simulate a stale socket
    writeFileSync(socketPath, 'stale');
    await expect(server.listen(socketPath)).resolves.toBeUndefined();
    expect(existsSync(socketPath)).toBe(true);
  });

  it('unknown route returns 404', async () => {
    await server.listen(socketPath);
    const resp = await request(socketPath, 'GET /unknown HTTP/1.1\r\n\r\n');
    expect(resp).toMatch(/^HTTP\/1\.1 404 Not Found/);
  });

  it('malformed request returns 400', async () => {
    await server.listen(socketPath);
    const resp = await request(socketPath, 'GARBAGE\r\n\r\n');
    expect(resp).toMatch(/^HTTP\/1\.1 400 Bad Request/);
  });

  it('oversized request returns 413', async () => {
    await server.listen(socketPath);
    // 9 KB of garbage -- cumulative bytes exceed the 8 KB server cap
    const body = 'X'.repeat(9 * 1024);
    const resp = await request(socketPath, body);
    expect(resp).toMatch(/^HTTP\/1\.1 413 Payload Too Large/);
  });

  it('GET /secrets returns 200 with secrets map', async () => {
    const secrets = { STRIPE_KEY: 'sk_test', DATABASE_URL: 'postgres://x' };
    await server.close();
    server = createAgentServer(makeDeps({ getSecrets: () => secrets }));
    await server.listen(socketPath);
    const resp = await request(socketPath, 'GET /secrets HTTP/1.1\r\n\r\n');
    expect(resp).toMatch(/^HTTP\/1\.1 200 OK/);
    const body = JSON.parse(resp.split('\r\n\r\n')[1]);
    expect(body).toEqual(secrets);
  });

  it('GET /secrets returns 200 with empty secrets map', async () => {
    await server.close();
    server = createAgentServer(makeDeps({ getSecrets: () => ({}) }));
    await server.listen(socketPath);
    const resp = await request(socketPath, 'GET /secrets HTTP/1.1\r\n\r\n');
    expect(resp).toMatch(/^HTTP\/1\.1 200 OK/);
    const body = JSON.parse(resp.split('\r\n\r\n')[1]);
    expect(body).toEqual({});
  });

  it('calls getSecrets each request', async () => {
    const spy = vi.fn(() => ({ KEY: 'val' }));
    await server.close();
    server = createAgentServer(makeDeps({ getSecrets: spy }));
    await server.listen(socketPath);
    await request(socketPath, 'GET /secrets HTTP/1.1\r\n\r\n');
    await request(socketPath, 'GET /secrets HTTP/1.1\r\n\r\n');
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('GET /something-else still returns 404', async () => {
    await server.listen(socketPath);
    const resp = await request(socketPath, 'GET /something-else HTTP/1.1\r\n\r\n');
    expect(resp).toMatch(/^HTTP\/1\.1 404 Not Found/);
  });

  it('POST /secrets returns 404 (only GET is supported)', async () => {
    await server.listen(socketPath);
    const resp = await request(socketPath, 'POST /secrets HTTP/1.1\r\n\r\n');
    expect(resp).toMatch(/^HTTP\/1\.1 404 Not Found/);
  });

  // GET /secrets/<KEY> tests
  it('GET /secrets/<KEY> returns 200 with key value', async () => {
    await server.close();
    server = createAgentServer(makeDeps({ getSecrets: () => ({ FOO: 'bar' }) }));
    await server.listen(socketPath);
    const resp = await request(socketPath, 'GET /secrets/FOO HTTP/1.1\r\n\r\n');
    expect(resp).toMatch(/^HTTP\/1\.1 200 OK/);
    const body = JSON.parse(resp.split('\r\n\r\n')[1]);
    expect(body).toEqual({ value: 'bar' });
  });

  it('GET /secrets/<KEY> returns 404 for unknown key', async () => {
    await server.close();
    server = createAgentServer(makeDeps({ getSecrets: () => ({ FOO: 'bar' }) }));
    await server.listen(socketPath);
    const resp = await request(socketPath, 'GET /secrets/MISSING HTTP/1.1\r\n\r\n');
    expect(resp).toMatch(/^HTTP\/1\.1 404 Not Found/);
    const body = JSON.parse(resp.split('\r\n\r\n')[1]);
    expect(body.error).toBe('not_found');
  });

  it('GET /secrets/<KEY> returns 400 for invalid key with hyphen', async () => {
    await server.listen(socketPath);
    const resp = await request(socketPath, 'GET /secrets/foo-bar HTTP/1.1\r\n\r\n');
    expect(resp).toMatch(/^HTTP\/1\.1 400 Bad Request/);
    const body = JSON.parse(resp.split('\r\n\r\n')[1]);
    expect(body.error).toBe('invalid_key');
  });

  it('GET /secrets/<KEY> returns 400 for key starting with digit', async () => {
    await server.listen(socketPath);
    const resp = await request(socketPath, 'GET /secrets/1FOO HTTP/1.1\r\n\r\n');
    expect(resp).toMatch(/^HTTP\/1\.1 400 Bad Request/);
    const body = JSON.parse(resp.split('\r\n\r\n')[1]);
    expect(body.error).toBe('invalid_key');
  });

  it('GET /secrets/<KEY> returns 400 for empty key (trailing slash)', async () => {
    await server.listen(socketPath);
    const resp = await request(socketPath, 'GET /secrets/ HTTP/1.1\r\n\r\n');
    expect(resp).toMatch(/^HTTP\/1\.1 400 Bad Request/);
    const body = JSON.parse(resp.split('\r\n\r\n')[1]);
    expect(body.error).toBe('invalid_key');
  });

  // POST /refresh tests
  it('POST /refresh calls deps.refresh()', async () => {
    const spy = vi.fn();
    await server.close();
    server = createAgentServer(makeDeps({ refresh: spy }));
    await server.listen(socketPath);
    await request(socketPath, 'POST /refresh HTTP/1.1\r\n\r\n');
    expect(spy).toHaveBeenCalledOnce();
  });

  it('POST /refresh returns 200 with reloaded:true', async () => {
    await server.close();
    server = createAgentServer(makeDeps());
    await server.listen(socketPath);
    const resp = await request(socketPath, 'POST /refresh HTTP/1.1\r\n\r\n');
    expect(resp).toMatch(/^HTTP\/1\.1 200 OK/);
    const body = JSON.parse(resp.split('\r\n\r\n')[1]);
    expect(body).toEqual({ reloaded: true });
  });

  it('GET /refresh returns 404 (only POST is supported)', async () => {
    await server.listen(socketPath);
    const resp = await request(socketPath, 'GET /refresh HTTP/1.1\r\n\r\n');
    expect(resp).toMatch(/^HTTP\/1\.1 404 Not Found/);
  });

  it('POST to other paths returns 404', async () => {
    await server.listen(socketPath);
    const resp1 = await request(socketPath, 'POST /secrets HTTP/1.1\r\n\r\n');
    expect(resp1).toMatch(/^HTTP\/1\.1 404 Not Found/);
    const resp2 = await request(socketPath, 'POST /random HTTP/1.1\r\n\r\n');
    expect(resp2).toMatch(/^HTTP\/1\.1 404 Not Found/);
  });

  // GET /health tests
  it('GET /health returns 200 with app and secret count', async () => {
    await server.close();
    const secrets = { STRIPE_KEY: 'sk_test', DATABASE_URL: 'postgres://x', JWT_SECRET: 'abc' };
    server = createAgentServer(makeDeps({ app: 'myapp', getSecrets: () => secrets }));
    await server.listen(socketPath);
    const resp = await request(socketPath, 'GET /health HTTP/1.1\r\n\r\n');
    expect(resp).toMatch(/^HTTP\/1\.1 200 OK/);
    const body = JSON.parse(resp.split('\r\n\r\n')[1]);
    expect(body).toEqual({ app: 'myapp', secrets: 3 });
  });

  it('GET /health returns count 0 when secrets map is empty', async () => {
    await server.close();
    server = createAgentServer(makeDeps({ app: 'myapp', getSecrets: () => ({}) }));
    await server.listen(socketPath);
    const resp = await request(socketPath, 'GET /health HTTP/1.1\r\n\r\n');
    expect(resp).toMatch(/^HTTP\/1\.1 200 OK/);
    const body = JSON.parse(resp.split('\r\n\r\n')[1]);
    expect(body).toEqual({ app: 'myapp', secrets: 0 });
  });

  it('GET /health body does not leak secret names or values', async () => {
    await server.close();
    server = createAgentServer(makeDeps({ app: 'myapp', getSecrets: () => ({ MYSECRET: 'foo' }) }));
    await server.listen(socketPath);
    const resp = await request(socketPath, 'GET /health HTTP/1.1\r\n\r\n');
    expect(resp).toMatch(/^HTTP\/1\.1 200 OK/);
    const bodyText = resp.split('\r\n\r\n')[1];
    expect(bodyText).not.toContain('MYSECRET');
    expect(bodyText).not.toContain('foo');
  });

  it('POST /health returns 404 (GET only)', async () => {
    await server.listen(socketPath);
    const resp = await request(socketPath, 'POST /health HTTP/1.1\r\n\r\n');
    expect(resp).toMatch(/^HTTP\/1\.1 404 Not Found/);
  });
});

// rate limiter tests
describe('rate limiter', () => {
  let tmpDir: string;
  let socketPath: string;
  let server: ReturnType<typeof createAgentServer>;

  beforeEach(async () => {
    _resetRateLimit();
    vi.mocked(existsSync).mockReset();
    vi.mocked(existsSync).mockImplementation(
      (p: Parameters<typeof existsSync>[0]) => statSync(p as string, { throwIfNoEntry: false }) !== undefined,
    );
    tmpDir = mkdtempSync(join(tmpdir(), 'fleet-v2-rl-test-'));
    socketPath = join(tmpDir, 'agent.sock');
    server = createAgentServer(makeDeps());
    await server.listen(socketPath);
  });

  afterEach(async () => {
    await server.close();
    rmSync(tmpDir, { recursive: true, force: true });
    vi.mocked(existsSync).mockReset();
  });

  it('next request after bucket is empty returns 429', async () => {
    // start with 1 token — first succeeds, second is immediately rate limited
    _resetRateLimit(1);

    const first = await request(socketPath, 'GET /health HTTP/1.1\r\n\r\n');
    expect(first).toMatch(/^HTTP\/1\.1 200/);

    const second = await request(socketPath, 'GET /health HTTP/1.1\r\n\r\n');
    expect(second).toMatch(/^HTTP\/1\.1 429/);
    const body = JSON.parse(second.split('\r\n\r\n')[1]);
    expect(body.error).toBe('rate_limited');
  });

  it('bucket refills: after exhaustion, waiting 100ms allows ~10 more requests', async () => {
    // exhaust the bucket
    _resetRateLimit(0);

    // wait 100ms — refills ~10 tokens (100 tokens/sec * 0.1s)
    await new Promise<void>((resolve) => setTimeout(resolve, 110));

    let successCount = 0;
    for (let i = 0; i < 10; i++) {
      const resp = await request(socketPath, 'GET /health HTTP/1.1\r\n\r\n');
      if (resp.startsWith('HTTP/1.1 200')) successCount++;
    }
    expect(successCount).toBeGreaterThanOrEqual(5);
    expect(successCount).toBe(10);
  }, 15_000);
});

// idle timeout tests
describe('idle timeout', () => {
  it('IDLE_TIMEOUT_MS is 30000', () => {
    expect(IDLE_TIMEOUT_MS).toBe(30_000);
  });

  it('connection remains open for at least 200ms without data (timeout is not too aggressive)', async () => {
    vi.mocked(existsSync).mockReset();
    vi.mocked(existsSync).mockImplementation(
      (p: Parameters<typeof existsSync>[0]) => statSync(p as string, { throwIfNoEntry: false }) !== undefined,
    );
    const tmpDir = mkdtempSync(join(tmpdir(), 'fleet-v2-idle-test-'));
    const socketPath = join(tmpDir, 'agent.sock');
    const server = createAgentServer(makeDeps());
    await server.listen(socketPath);

    try {
      const stillOpen = await new Promise<boolean>((resolve) => {
        const sock = createConnection(socketPath);
        let closed = false;
        sock.on('connect', () => {
          setTimeout(() => {
            if (!closed) {
              sock.destroy();
              resolve(true);
            } else {
              resolve(false);
            }
          }, 200);
        });
        sock.on('close', () => { closed = true; });
        sock.on('error', () => { closed = true; });
      });
      expect(stillOpen).toBeTruthy();
    } finally {
      await server.close();
      rmSync(tmpDir, { recursive: true, force: true });
      vi.mocked(existsSync).mockReset();
    }
  });
});

// multi-chunk header scan tests
describe('multi-chunk request handling', () => {
  let tmpDir: string;
  let socketPath: string;
  let server: ReturnType<typeof createAgentServer>;

  beforeEach(async () => {
    _resetRateLimit();
    vi.mocked(existsSync).mockReset();
    vi.mocked(existsSync).mockImplementation(
      (p: Parameters<typeof existsSync>[0]) => statSync(p as string, { throwIfNoEntry: false }) !== undefined,
    );
    tmpDir = mkdtempSync(join(tmpdir(), 'fleet-v2-chunk-test-'));
    socketPath = join(tmpDir, 'agent.sock');
    server = createAgentServer(makeDeps());
    await server.listen(socketPath);
  });

  afterEach(async () => {
    await server.close();
    rmSync(tmpDir, { recursive: true, force: true });
    vi.mocked(existsSync).mockReset();
  });

  it('request sent in small 4-byte chunks gets 200 response', async () => {
    const raw = 'GET /health HTTP/1.1\r\n\r\n';
    const chunkSize = 4;

    const resp = await new Promise<string>((resolve, reject) => {
      const sock = createConnection(socketPath);
      const chunks: Buffer[] = [];
      sock.on('connect', () => {
        let offset = 0;
        const writeNextChunk = () => {
          if (offset >= raw.length) return;
          const slice = raw.slice(offset, offset + chunkSize);
          sock.write(slice);
          offset += chunkSize;
          if (offset < raw.length) {
            setTimeout(writeNextChunk, 5);
          }
        };
        writeNextChunk();
      });
      sock.on('data', (c: Buffer) => chunks.push(c));
      sock.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
      sock.on('error', reject);
      sock.setTimeout(3000, () => { sock.destroy(); reject(new Error('timeout')); });
    });

    expect(resp).toMatch(/^HTTP\/1\.1 200 OK/);
  });

  it('\\r\\n\\r\\n split across chunk boundary is detected correctly', async () => {
    // terminator split across two writes: part1 ends with \r\n, part2 is \r\n
    const part1 = 'GET /health HTTP/1.1\r\n';
    const part2 = '\r\n';

    const resp = await new Promise<string>((resolve, reject) => {
      const sock = createConnection(socketPath);
      const chunks: Buffer[] = [];
      sock.on('connect', () => {
        sock.write(part1);
        setTimeout(() => sock.write(part2), 10);
      });
      sock.on('data', (c: Buffer) => chunks.push(c));
      sock.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
      sock.on('error', reject);
      sock.setTimeout(3000, () => { sock.destroy(); reject(new Error('timeout')); });
    });

    expect(resp).toMatch(/^HTTP\/1\.1 200 OK/);
  });
});

// parseArgs tests
describe('parseArgs', () => {
  it('parses all required flags', () => {
    const args = parseArgs(['--app', 'foo', '--vault', '/home/matt/fleet/vault', '--socket', '/run/fleet-secrets/foo.sock']);
    expect(args).toEqual({ app: 'foo', vault: '/home/matt/fleet/vault', socket: '/run/fleet-secrets/foo.sock' });
  });

  it('throws on missing --app', () => {
    expect(() => parseArgs(['--vault', '/vault', '--socket', '/sock'])).toThrow(SecretsError);
  });

  it('throws on missing --vault', () => {
    expect(() => parseArgs(['--app', 'foo', '--socket', '/sock'])).toThrow(SecretsError);
  });

  it('throws on missing --socket', () => {
    expect(() => parseArgs(['--app', 'foo', '--vault', '/vault'])).toThrow(SecretsError);
  });

  it('accepts optional --credential', () => {
    const args = parseArgs(['--app', 'foo', '--vault', '/vault', '--socket', '/sock', '--credential', '/run/creds/key']);
    expect(args.credential).toBe('/run/creds/key');
  });

  it('throws on unknown flag', () => {
    expect(() => parseArgs(['--app', 'foo', '--vault', '/vault', '--socket', '/sock', '--unknown', 'val'])).toThrow(SecretsError);
  });

  it('throws on flag without value (trailing flag)', () => {
    expect(() => parseArgs(['--app'])).toThrow(SecretsError);
  });

  it('parses multiple flags in any order', () => {
    const args = parseArgs(['--socket', '/sock', '--app', 'bar', '--vault', '/v']);
    expect(args.app).toBe('bar');
    expect(args.vault).toBe('/v');
    expect(args.socket).toBe('/sock');
  });
});

// chmod warning tests
describe('chmod warning', () => {
  it('logs a WARNING to stderr when chmodSync throws', async () => {
    const chmodSync = await import('node:fs').then((m) => m.chmodSync);
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const chmodSpy = vi.spyOn(await import('node:fs'), 'chmodSync').mockImplementationOnce(() => {
      throw new Error('EPERM: operation not permitted');
    });

    vi.mocked(existsSync).mockReset();
    vi.mocked(existsSync).mockImplementation(
      (p: Parameters<typeof existsSync>[0]) => statSync(p as string, { throwIfNoEntry: false }) !== undefined,
    );

    const tmpDir = mkdtempSync(join(tmpdir(), 'fleet-v2-chmod-test-'));
    const socketPath = join(tmpDir, 'agent.sock');
    const server = createAgentServer({
      app: 'testapp',
      getSecrets: () => ({}),
      refresh: () => {},
    });

    try {
      await server.listen(socketPath);
      const calls = stderrSpy.mock.calls.map((c) => String(c[0]));
      const warnCall = calls.find((s) => s.includes('chmod') && s.includes('WARNING'));
      expect(warnCall).toBeDefined();
    } finally {
      await server.close();
      rmSync(tmpDir, { recursive: true, force: true });
      stderrSpy.mockRestore();
      chmodSpy.mockRestore();
      vi.mocked(existsSync).mockReset();
    }
  });
});

// main() input validation tests
describe('main', () => {
  it('throws SecretsError when no credential path is available', async () => {
    const origCredsDir = process.env.CREDENTIALS_DIRECTORY;
    delete process.env.CREDENTIALS_DIRECTORY;
    try {
      await expect(
        main(['--app', 'foo', '--vault', '/nonexistent/vault', '--socket', '/nonexistent/sock']),
      ).rejects.toThrow(SecretsError);
    } finally {
      if (origCredsDir !== undefined) process.env.CREDENTIALS_DIRECTORY = origCredsDir;
    }
  });
});
