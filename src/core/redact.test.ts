import { describe, expect, it } from 'vitest';

import { scrubSecrets } from './redact';

describe('scrubSecrets', () => {
  it('redacts an age secret key', () => {
    const out = scrubSecrets('no identity matched AGE-SECRET-KEY-1QQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQ');
    expect(out).not.toMatch(/AGE-SECRET-KEY-1QQ/);
    expect(out).toContain('[redacted-age-key]');
  });

  it('redacts the password inside a connection-string URL', () => {
    const out = scrubSecrets('DATABASE_URL=postgres://user:s3cr3tp4ss@db.host:5432/app');
    expect(out).not.toContain('s3cr3tp4ss');
    // the DATABASE_URL name also matches the assignment rule, so the whole
    // value is redacted — the point is the password never survives.
    expect(out).toContain('[redacted]');
  });

  it('redacts a bare URL credential even without a secret-looking name', () => {
    const out = scrubSecrets('connecting to amqp://svc:p4ssw0rd@broker:5672');
    expect(out).not.toContain('p4ssw0rd');
    expect(out).toContain('amqp://svc:[redacted]@');
  });

  it('redacts the value of a secret-looking assignment', () => {
    expect(scrubSecrets('STRIPE_SECRET=sk_live_abcdef')).toContain('STRIPE_SECRET=[redacted]');
  });

  it('preserves line structure (not first-line-only)', () => {
    const out = scrubSecrets('line one\nTOKEN=abcdefghijklmnopqrstuvwx\nline three');
    expect(out).toContain('line one');
    expect(out).toContain('line three');
    expect(out).not.toContain('abcdefghijklmnopqrstuvwx');
  });

  it('returns empty string for empty input', () => {
    expect(scrubSecrets('')).toBe('');
  });

  it('caps very long input so the regex cannot stall', () => {
    // SECRET_ASSIGN backtracks quadratically on a long word-char run; the cap
    // bounds it. assert it returns quickly and is truncated.
    const huge = 'a'.repeat(100_000);
    const t0 = Date.now();
    const out = scrubSecrets(huge);
    expect(Date.now() - t0).toBeLessThan(500);
    expect(out.length).toBeLessThan(10_000);
    expect(out).toContain('[truncated]');
  });
});
