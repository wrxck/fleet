import { existsSync, statSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createConnection } from 'node:net';

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { execSafe } from './exec.js';
import type { ExecResult } from './exec.js';
import { SecretsError } from './errors.js';
import { decryptVaultBlob, createServer as createAgentServer, type AgentDeps } from './secrets-v2.js';

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
});
