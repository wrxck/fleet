import { describe, it, expect } from 'vitest';

import { scrubForAudit } from './redact';

describe('scrubForAudit', () => {
  it('redacts an age secret key', () => {
    const out = scrubForAudit('decrypt failed for AGE-SECRET-KEY-1QQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQ now');
    expect(out).not.toMatch(/AGE-SECRET-KEY-1QQ/);
    expect(out).toContain('[redacted-age-key]');
  });

  it('redacts the value of a secret-looking KEY=value', () => {
    const out = scrubForAudit('env: DB_PASSWORD=hunter2hunter2hunter2 set');
    expect(out).toContain('DB_PASSWORD=[redacted]');
    expect(out).not.toContain('hunter2hunter2hunter2');
  });

  it('redacts a long high-entropy token', () => {
    const out = scrubForAudit('bearer deadbeefdeadbeefdeadbeefdeadbeef0123 used');
    expect(out).not.toContain('deadbeefdeadbeefdeadbeefdeadbeef0123');
    expect(out).toContain('[redacted]');
  });

  it('keeps only the first non-empty line', () => {
    const out = scrubForAudit('\n  first line here\nsecond line\nthird');
    expect(out).toBe('first line here');
  });

  it('caps length and appends an ellipsis', () => {
    // a long, non-secret-looking line (spaces break the high-entropy run, so it
    // survives redaction and exercises the length cap on the redact-then-cap path)
    const out = scrubForAudit('cap '.repeat(200));
    expect(out.length).toBeLessThanOrEqual(301);
    expect(out.endsWith('…')).toBeTruthy();
  });

  it('still caps even when the long content is a high-entropy token', () => {
    // redaction collapses the token to a short marker; the result is well under
    // the cap, so there is no ellipsis — capping must not pre-truncate secrets.
    const out = scrubForAudit('x'.repeat(400));
    expect(out).toBe('[redacted]');
  });

  it('returns empty string for empty input', () => {
    expect(scrubForAudit('')).toBe('');
  });
});
