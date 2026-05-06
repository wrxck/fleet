import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./exec.js', () => ({
  execSafe: vi.fn(),
}));

import { execSafe } from './exec.js';
import type { ExecResult } from './exec.js';
import { generateKeypair } from './secrets-v2-keypair.js';

const ok = (stdout: string): ExecResult => ({ ok: true, stdout, stderr: '', exitCode: 0 });
const fail = (stderr: string): ExecResult => ({ ok: false, stdout: '', stderr, exitCode: 1 });

describe('generateKeypair', () => {
  beforeEach(() => { vi.mocked(execSafe).mockReset(); });

  it('runs age-keygen and parses the keypair', () => {
    vi.mocked(execSafe).mockReturnValueOnce(
      ok('# created: 2026-05-06T00:00:00Z\n# public key: age1pubkey1234\nAGE-SECRET-KEY-1ABC123\n'),
    );
    const kp = generateKeypair();
    expect(kp.publicKey).toBe('age1pubkey1234');
    expect(kp.privateKey).toBe('AGE-SECRET-KEY-1ABC123');
    expect(execSafe).toHaveBeenCalledWith('age-keygen', []);
  });

  it('throws SecretsError when age-keygen fails', () => {
    vi.mocked(execSafe).mockReturnValueOnce(fail('oom'));
    expect(() => generateKeypair()).toThrow(/age-keygen failed/);
  });

  it('throws SecretsError when stdout is missing the public key line', () => {
    vi.mocked(execSafe).mockReturnValueOnce(ok('GARBAGE\n'));
    expect(() => generateKeypair()).toThrow(/could not parse/);
  });

  it('throws SecretsError when stdout is missing the private key line', () => {
    vi.mocked(execSafe).mockReturnValueOnce(ok('# public key: age1pub\n'));
    expect(() => generateKeypair()).toThrow(/could not parse/);
  });

  it('does not include the private key in parse-failure error message', () => {
    // stdout has a private key line but is missing the public key line, so parse fails
    vi.mocked(execSafe).mockReturnValueOnce(
      ok('# created: 2026-05-06T00:00:00Z\nAGE-SECRET-KEY-1MUST_NOT_APPEAR_IN_ERROR_MSG\n'),
    );
    let caught: Error | null = null;
    try { generateKeypair(); } catch (e) { caught = e as Error; }
    expect(caught).not.toBeNull();
    expect(caught!.message).not.toContain('AGE-SECRET-KEY-');
    expect(caught!.message).not.toContain('MUST_NOT_APPEAR_IN_ERROR_MSG');
  });
});
