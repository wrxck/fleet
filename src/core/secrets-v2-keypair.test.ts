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

  it('does not leak private key with leading whitespace in parse-failure error', () => {
    // hostile or corrupted age-keygen variant: emits the key with leading spaces
    vi.mocked(execSafe).mockReturnValueOnce({
      ok: true,
      stdout: '# created: 2026-05-06T00:00:00Z\n  AGE-SECRET-KEY-1WHITESPACE_LEAK_MARKER\n',
      stderr: '', exitCode: 0,
    } satisfies ExecResult);
    let caught: Error | null = null;
    try { generateKeypair(); } catch (e) { caught = e as Error; }
    expect(caught).not.toBeNull();
    expect(caught!.message).not.toContain('AGE-SECRET-KEY-');
    expect(caught!.message).not.toContain('WHITESPACE_LEAK_MARKER');
  });

  it('does not leak private key embedded mid-line in parse-failure error', () => {
    // hostile variant: emits key inline in a synthesised log line
    vi.mocked(execSafe).mockReturnValueOnce({
      ok: true,
      stdout: '# created: 2026-05-06T00:00:00Z\nlog: generated AGE-SECRET-KEY-1INLINE_LEAK_MARKER successfully\n',
      stderr: '', exitCode: 0,
    } satisfies ExecResult);
    let caught: Error | null = null;
    try { generateKeypair(); } catch (e) { caught = e as Error; }
    expect(caught).not.toBeNull();
    expect(caught!.message).not.toContain('AGE-SECRET-KEY-');
    expect(caught!.message).not.toContain('INLINE_LEAK_MARKER');
  });
});
