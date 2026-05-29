import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./exec.js', () => ({
  execSafe: vi.fn(),
}));

import { execSafe } from './exec';
import type { ExecResult } from './exec';
import { generateKeypair, reencryptForRecipient } from './secrets-v2-keypair';

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

describe('reencryptForRecipient', () => {
  beforeEach(() => { vi.mocked(execSafe).mockReset(); });

  it('happy path: decrypts then re-encrypts and returns ciphertext', () => {
    const plaintext = 'my secret value';
    const reencrypted = '-----BEGIN AGE ENCRYPTED FILE-----\nnewciphertext\n-----END AGE ENCRYPTED FILE-----';
    vi.mocked(execSafe)
      .mockReturnValueOnce(ok(plaintext))      // decrypt call
      .mockReturnValueOnce(ok(reencrypted));   // encrypt call
    const result = reencryptForRecipient({
      ciphertext: '-----BEGIN AGE ENCRYPTED FILE-----\noldciphertext\n-----END AGE ENCRYPTED FILE-----',
      oldKeyPath: '/etc/fleet/age.key',
      newRecipient: 'age1newpubkey',
    });
    expect(result).toBe(reencrypted);
  });

  it('throws SecretsError containing "decrypt failed" when decrypt fails', () => {
    vi.mocked(execSafe).mockReturnValueOnce(fail('bad key'));
    expect(() =>
      reencryptForRecipient({
        ciphertext: 'armoured-blob',
        oldKeyPath: '/etc/fleet/age.key',
        newRecipient: 'age1newpubkey',
      }),
    ).toThrow(/decrypt failed/);
    // encrypt must never have been called
    expect(vi.mocked(execSafe)).toHaveBeenCalledTimes(1);
  });

  it('throws SecretsError containing "encrypt failed" when encrypt fails', () => {
    vi.mocked(execSafe)
      .mockReturnValueOnce(ok('plaintext'))
      .mockReturnValueOnce(fail('recipient not found'));
    expect(() =>
      reencryptForRecipient({
        ciphertext: 'armoured-blob',
        oldKeyPath: '/etc/fleet/age.key',
        newRecipient: 'age1newpubkey',
      }),
    ).toThrow(/encrypt failed/);
  });

  it('calls execSafe with the correct arguments for both operations', () => {
    const ciphertext = '-----BEGIN AGE ENCRYPTED FILE-----\nblob\n-----END AGE ENCRYPTED FILE-----';
    const oldKeyPath = '/etc/fleet/age.key';
    const newRecipient = 'age1pubrecipient';
    const plaintext = 'decrypted-secret';
    const reencrypted = '-----BEGIN AGE ENCRYPTED FILE-----\nnewblob\n-----END AGE ENCRYPTED FILE-----';
    vi.mocked(execSafe)
      .mockReturnValueOnce(ok(plaintext))
      .mockReturnValueOnce(ok(reencrypted));
    reencryptForRecipient({ ciphertext, oldKeyPath, newRecipient });
    const calls = vi.mocked(execSafe).mock.calls;
    expect(calls).toHaveLength(2);
    // first call: age -d -i <oldKeyPath>, input = ciphertext
    expect(calls[0]).toEqual(['age', ['-d', '-i', oldKeyPath], { input: ciphertext }]);
    // second call: age -r <newRecipient> --armor, input = decrypted plaintext
    expect(calls[1]).toEqual(['age', ['-r', newRecipient, '--armor'], { input: plaintext }]);
  });

  it('does not include plaintext or AGE-SECRET-KEY- in error message when encrypt fails', () => {
    const sensitivePayload = 'AGE-SECRET-KEY-1SUPERSECRET_PAYLOAD_MUST_NOT_LEAK';
    vi.mocked(execSafe)
      .mockReturnValueOnce(ok(sensitivePayload))   // decrypt succeeds, returns sensitive plaintext
      .mockReturnValueOnce(fail('age: recipient error'));  // encrypt fails
    let caught: Error | null = null;
    try {
      reencryptForRecipient({
        ciphertext: 'armoured-blob',
        oldKeyPath: '/etc/fleet/age.key',
        newRecipient: 'age1newpubkey',
      });
    } catch (e) { caught = e as Error; }
    expect(caught).not.toBeNull();
    expect(caught!.message).not.toContain('AGE-SECRET-KEY-');
    expect(caught!.message).not.toContain('SUPERSECRET_PAYLOAD_MUST_NOT_LEAK');
    expect(caught!.message).not.toContain(sensitivePayload);
  });
});
