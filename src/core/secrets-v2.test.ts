import { existsSync } from 'node:fs';

import { describe, it, expect, vi, beforeEach } from 'vitest';

import { execSafe } from './exec.js';
import type { ExecResult } from './exec.js';
import { SecretsError } from './errors.js';
import { decryptVaultBlob } from './secrets-v2.js';

vi.mock('node:fs', () => ({ existsSync: vi.fn() }));
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
    // synthetic stderr with key material — age never actually emits this; regression guard only
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
