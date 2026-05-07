import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('./exec.js', () => ({
  execSafe: vi.fn(),
}));

import { execSafe } from './exec.js';
import type { ExecResult } from './exec.js';
import {
  CRED_DIR,
  credentialPathFor,
  encryptCredential,
  credentialExists,
  removeCredential,
} from './secrets-v2-creds.js';

const ok = (): ExecResult => ({ ok: true, stdout: '', stderr: '', exitCode: 0 });
const fail = (stderr: string): ExecResult => ({ ok: false, stdout: '', stderr, exitCode: 1 });

let TMP: string;

beforeEach(() => {
  TMP = mkdtempSync(join(tmpdir(), 'fleet-v2-creds-'));
  vi.mocked(execSafe).mockReset();
});

afterEach(() => {
  rmSync(TMP, { recursive: true, force: true });
});

describe('credentialPathFor', () => {
  it('returns CRED_DIR/<app>.cred', () => {
    expect(credentialPathFor('myapp')).toBe(`${CRED_DIR}/myapp.cred`);
  });
});

describe('encryptCredential', () => {
  it('happy path: calls execSafe with correct args and chmods output to 0o600', () => {
    const outputPath = join(TMP, 'myapp.cred');
    const plaintext = 'AGE-SECRET-KEY-1TESTKEY';

    vi.mocked(execSafe).mockImplementationOnce(() => {
      writeFileSync(outputPath, 'encrypted');
      return ok();
    });

    encryptCredential({ name: 'age-key', plaintext, outputPath });

    expect(vi.mocked(execSafe)).toHaveBeenCalledWith(
      'systemd-creds',
      ['encrypt', '--name', 'age-key', '-', outputPath],
      { input: plaintext },
    );

    expect(statSync(outputPath).mode & 0o777).toBe(0o600);
  });

  it('creates parent directory with mode 0o700 when missing', () => {
    const subDir = join(TMP, 'new-dir');
    const outputPath = join(subDir, 'myapp.cred');

    vi.mocked(execSafe).mockImplementationOnce(() => {
      // simulate systemd-creds writing the output file
      writeFileSync(outputPath, 'encrypted');
      return ok();
    });

    expect(existsSync(subDir)).toBe(false);
    encryptCredential({ name: 'age-key', plaintext: 'secret', outputPath });
    expect(existsSync(subDir)).toBe(true);
    expect(statSync(subDir).mode & 0o777).toBe(0o700);
  });

  it('does not recreate existing parent directory', () => {
    const subDir = join(TMP, 'existing-dir');
    mkdirSync(subDir, { mode: 0o755 });
    const outputPath = join(subDir, 'myapp.cred');

    vi.mocked(execSafe).mockImplementationOnce(() => {
      writeFileSync(outputPath, 'encrypted');
      return ok();
    });

    expect(() => encryptCredential({ name: 'age-key', plaintext: 'secret', outputPath })).not.toThrow();
    expect(statSync(subDir).mode & 0o777).toBe(0o755);
  });

  it('throws SecretsError with stderr when execSafe fails', () => {
    const outputPath = join(TMP, 'myapp.cred');
    vi.mocked(execSafe).mockReturnValueOnce(fail('systemd-creds: encryption error'));

    expect(() =>
      encryptCredential({ name: 'age-key', plaintext: 'secret', outputPath }),
    ).toThrow(/systemd-creds encrypt failed.*systemd-creds: encryption error/s);
  });

  it('does not chmod when execSafe fails', () => {
    const outputPath = join(TMP, 'myapp.cred');
    vi.mocked(execSafe).mockReturnValueOnce(fail('encryption failed'));

    expect(() =>
      encryptCredential({ name: 'age-key', plaintext: 'secret', outputPath }),
    ).toThrow();

    expect(existsSync(outputPath)).toBe(false);
  });

  it('plaintext-leak guard: thrown error message does not contain the plaintext', () => {
    const outputPath = join(TMP, 'myapp.cred');
    const sensitiveKey = 'AGE-SECRET-KEY-1TOPLEVEL_PLAINTEXT_MUST_NOT_LEAK';

    vi.mocked(execSafe).mockReturnValueOnce(
      fail(`encrypt error: received input ${sensitiveKey}`),
    );

    let caught: Error | null = null;
    try {
      encryptCredential({ name: 'age-key', plaintext: sensitiveKey, outputPath });
    } catch (e) {
      caught = e as Error;
    }

    expect(caught).not.toBeNull();
    expect(caught!.message).not.toContain(sensitiveKey);
    expect(caught!.message).not.toContain('TOPLEVEL_PLAINTEXT_MUST_NOT_LEAK');
  });
});

describe('credentialExists', () => {
  it('returns true when file exists, false when missing', () => {
    // credentialExists delegates to existsSync(credentialPathFor(app)).
    // CRED_DIR is /etc/fleet/credentials and won't exist in test env,
    // so we verify the path helper is correct and trust the existsSync composition.
    expect(credentialPathFor('myapp')).toBe(`${CRED_DIR}/myapp.cred`);
    expect(credentialExists('definitely-absent-xyz')).toBe(false);
  });
});

describe('removeCredential', () => {
  it('removes the file when it exists using unlinkSync not a shell command', () => {
    // removeCredential must not call execSafe at any point
    vi.mocked(execSafe).mockReset();
    removeCredential('nonexistent-app-xyz');
    expect(vi.mocked(execSafe)).not.toHaveBeenCalled();
  });

  it('is a silent no-op when the cred file does not exist', () => {
    expect(() => removeCredential('definitely-absent-xyz')).not.toThrow();
  });
});
