import { describe, it, expect } from 'vitest';

import { generateSecret, totpCode, verifyTotp, totpUri } from './totp';

const RFC_SECRET = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';

describe('backup/totp', () => {
  it('matches RFC 6238 test vectors (6-digit)', () => {
    expect(totpCode(RFC_SECRET, 59_000)).toBe('287082');
    expect(totpCode(RFC_SECRET, 1_111_111_109_000)).toBe('081804');
    expect(totpCode(RFC_SECRET, 1_234_567_890_000)).toBe('005924');
  });

  it('verifyTotp accepts a current code', () => {
    const now = 1_700_000_000_000;
    expect(verifyTotp(RFC_SECRET, totpCode(RFC_SECRET, now), now)).toBe(true);
  });

  it('verifyTotp accepts a code from the adjacent step (clock skew)', () => {
    const now = 1_700_000_000_000;
    const prev = totpCode(RFC_SECRET, now - 30_000);
    expect(verifyTotp(RFC_SECRET, prev, now)).toBe(true);
  });

  it('verifyTotp rejects a code two steps away', () => {
    const now = 1_700_000_000_000;
    const old = totpCode(RFC_SECRET, now - 90_000);
    expect(verifyTotp(RFC_SECRET, old, now)).toBe(false);
  });

  it('verifyTotp rejects malformed input', () => {
    expect(verifyTotp(RFC_SECRET, 'abcdef')).toBe(false);
    expect(verifyTotp(RFC_SECRET, '12345')).toBe(false);
    expect(verifyTotp(RFC_SECRET, '')).toBe(false);
  });

  it('generateSecret produces a usable base32 secret', () => {
    const s = generateSecret();
    expect(s).toMatch(/^[A-Z2-7]+$/);
    expect(s.length).toBeGreaterThanOrEqual(32);
    expect(totpCode(s, 0)).toMatch(/^\d{6}$/);
  });

  it('totpUri builds a scannable otpauth URI', () => {
    const uri = totpUri(RFC_SECRET, 'matt', 'fleet-backups');
    expect(uri).toContain('otpauth://totp/');
    expect(uri).toContain(`secret=${RFC_SECRET}`);
    expect(uri).toContain('issuer=fleet-backups');
  });
});
