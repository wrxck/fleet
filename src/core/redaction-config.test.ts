import { describe, it, expect } from 'vitest';

import {
  DEFAULT_REDACTION,
  effectiveRedaction,
  hasNestedUnboundedQuantifier,
  redactText,
  resolveRedaction,
} from './redaction';
import type { AppEntry } from './registry';

function app(overrides: Partial<AppEntry> = {}): AppEntry {
  return {
    name: 'poolside',
    displayName: 'poolside',
    composePath: '/tmp/poolside',
    composeFile: null,
    serviceName: 'poolside',
    domains: [],
    port: null,
    usesSharedDb: false,
    type: 'nextjs',
    containers: ['poolside'],
    dependsOnDatabases: false,
    registeredAt: '',
    ...overrides,
  };
}

const noFp = { fingerprint: false } as const;

describe('effectiveRedaction', () => {
  it('returns the shared defaults when nothing is configured', () => {
    expect(effectiveRedaction(app())).toBe(DEFAULT_REDACTION);
    expect(effectiveRedaction(app()).enabled).toBe(true);
  });

  it('reads per-app config from logging.redaction', () => {
    const cfg = effectiveRedaction(app({ logging: { redaction: { enabled: false } } }));
    expect(cfg.enabled).toBe(false);
  });

  it('also accepts a top-level redaction key', () => {
    const entry = { ...app(), redaction: { categories: { ip: true } } } as AppEntry;
    expect(effectiveRedaction(entry).categories.ip).toBe(true);
  });

  it('overrides only the categories listed, keeping the rest at defaults', () => {
    const cfg = effectiveRedaction(app({ logging: { redaction: { categories: { email: false, ip: true } } } }));
    expect(cfg.categories.email).toBe(false);
    expect(cfg.categories.ip).toBe(true);
    expect(cfg.categories.private_key).toBe(true);
    expect(cfg.categories.phone).toBe(false);
  });

  it('inherits the per-app policy through a real read', () => {
    const cfg = effectiveRedaction(app({ logging: { retentionDays: 3, redaction: { categories: { email: false } } } }));
    const out = redactText('signup alice@example.com with DB_PASSWORD=hunter2', { ...cfg, fingerprint: false });
    expect(out.text).toBe('signup alice@example.com with DB_PASSWORD=[REDACTED:generic_assignment]');
  });
});

describe('disabling redaction', () => {
  it('returns the input byte-identical when disabled', () => {
    const cfg = resolveRedaction({ enabled: false });
    const input = 'DB_PASSWORD=hunter2 alice@example.com ghp_1234567890abcdefghijklmnopqrstuvwxyz';
    expect(redactText(input, cfg)).toEqual({ text: input, counts: {} });
  });

  it('a disabled category is a no-op for that category only', () => {
    const cfg = resolveRedaction({ ...noFp, categories: { email: false } });
    expect(redactText('alice@example.com DB_PASSWORD=hunter2', cfg).text)
      .toBe('alice@example.com DB_PASSWORD=[REDACTED:generic_assignment]');
  });
});

describe('allowlist precedence', () => {
  it('a literal allowlist entry beats a built-in pattern', () => {
    const cfg = resolveRedaction({ ...noFp, allowlist: ['ops@fleet.internal'] });
    expect(redactText('alert to ops@fleet.internal and alice@example.com', cfg).text)
      .toBe('alert to ops@fleet.internal and [REDACTED:email]');
  });

  it('a regex allowlist entry beats a built-in pattern', () => {
    const cfg = resolveRedaction({ ...noFp, allowlist: ['/[a-z]+@fleet\\.internal/'] });
    expect(redactText('to ops@fleet.internal and alice@example.com', cfg).text)
      .toBe('to ops@fleet.internal and [REDACTED:email]');
  });

  it('literal entries are escaped, not treated as regex', () => {
    const cfg = resolveRedaction({ ...noFp, allowlist: ['a.c@example.com'] });
    expect(redactText('a.c@example.com', cfg).text).toBe('a.c@example.com');
    expect(redactText('abc@example.com', cfg).text).toBe('[REDACTED:email]');
  });

  it('the allowlist beats a custom pattern too', () => {
    const cfg = resolveRedaction({
      ...noFp,
      customPatterns: [{ name: 'ticket', pattern: 'TKT-\\d+' }],
      allowlist: ['TKT-0'],
    });
    expect(redactText('TKT-0 and TKT-1234', cfg).text).toBe('TKT-0 and [REDACTED:ticket]');
  });

  it('an overlapping allowlist span suppresses the whole redaction', () => {
    const cfg = resolveRedaction({ ...noFp, allowlist: ['/hunter2 rotated/'] });
    expect(redactText('DB_PASSWORD=hunter2 rotated ok', cfg).text).toBe('DB_PASSWORD=hunter2 rotated ok');
  });
});

describe('custom patterns', () => {
  it('redacts the whole match when there is no capture group', () => {
    const cfg = resolveRedaction({ ...noFp, customPatterns: [{ name: 'internal_id', pattern: 'EMP-\\d{6}' }] });
    expect(redactText('user EMP-004521 logged in', cfg).text).toBe('user [REDACTED:internal_id] logged in');
  });

  it('redacts only capture group 1 when one is supplied', () => {
    const cfg = resolveRedaction({
      ...noFp,
      customPatterns: [{ name: 'seat', pattern: 'seat=([A-Z0-9]{6})' }],
    });
    expect(redactText('booking seat=AB12CD confirmed', cfg).text)
      .toBe('booking seat=[REDACTED:seat] confirmed');
  });

  it('honours the i flag and drops unsafe flags', () => {
    const cfg = resolveRedaction({
      ...noFp,
      customPatterns: [{ name: 'code', pattern: 'ref-[a-f]{4}', flags: 'igy' }],
    });
    expect(redactText('REF-ABCD and ref-beef', cfg).text)
      .toBe('[REDACTED:code] and [REDACTED:code]');
  });

  it('counts custom redactions under the pattern name', () => {
    const cfg = resolveRedaction({ ...noFp, customPatterns: [{ name: 'emp', pattern: 'EMP-\\d{6}' }] });
    expect(redactText('EMP-000001 EMP-000002', cfg).counts).toEqual({ emp: 2 });
  });

  it('skips an uncompilable pattern with a warning instead of throwing', () => {
    const cfg = resolveRedaction({ ...noFp, customPatterns: [{ name: 'broken', pattern: '([unclosed' }] });
    expect(cfg.customPatterns).toHaveLength(0);
    expect(cfg.warnings.join(' ')).toMatch(/failed to compile/);
    expect(() => redactText('anything at all', cfg)).not.toThrow();
    expect(redactText('anything at all', cfg).text).toBe('anything at all');
  });

  it('skips a pattern that matches the empty string', () => {
    const cfg = resolveRedaction({ ...noFp, customPatterns: [{ name: 'greedy', pattern: 'a*' }] });
    expect(cfg.customPatterns).toHaveLength(0);
    expect(cfg.warnings.join(' ')).toMatch(/empty string/);
  });

  it('skips a pattern with an unusable name', () => {
    const cfg = resolveRedaction({ ...noFp, customPatterns: [{ name: 'bad name!', pattern: 'x' }] });
    expect(cfg.customPatterns).toHaveLength(0);
    expect(cfg.warnings.join(' ')).toMatch(/\[A-Za-z0-9_\]/);
  });

  it('caps the number of patterns', () => {
    const many = Array.from({ length: 40 }, (_, i) => ({ name: `p${i}`, pattern: `Z${i}Z` }));
    const cfg = resolveRedaction({ ...noFp, customPatterns: many });
    expect(cfg.customPatterns).toHaveLength(32);
    expect(cfg.warnings.join(' ')).toMatch(/beyond the first 32/);
  });

  it('caps the pattern source length', () => {
    const cfg = resolveRedaction({ ...noFp, customPatterns: [{ name: 'huge', pattern: 'a'.repeat(1001) }] });
    expect(cfg.customPatterns).toHaveLength(0);
    expect(cfg.warnings.join(' ')).toMatch(/exceeds 1000 chars/);
  });

  it('does not run custom patterns against lines over the length cap', () => {
    const cfg = resolveRedaction({ ...noFp, customPatterns: [{ name: 'emp', pattern: 'EMP-\\d{6}' }] });
    const shortLine = 'EMP-000001';
    const longLine = `${'x'.repeat(cfg.maxCustomLineLength)} EMP-000002`;
    const out = redactText(`${shortLine}\n${longLine}`, cfg).text;
    expect(out).toContain('[REDACTED:emp]');
    // deliberate: an absurdly long line is a redos lever, so it is skipped for
    // operator patterns. built-ins still cover it.
    expect(out).toContain('EMP-000002');
  });

  it('built-in patterns still apply to lines over the custom-pattern cap', () => {
    const cfg = resolveRedaction({ ...noFp, customPatterns: [{ name: 'emp', pattern: 'EMP-\\d{6}' }] });
    const longLine = `${'x'.repeat(cfg.maxCustomLineLength)} DB_PASSWORD=hunter2`;
    expect(redactText(longLine, cfg).text).toContain('[REDACTED:generic_assignment]');
  });
});

describe('redos screening', () => {
  it('flags nested unbounded quantifiers', () => {
    expect(hasNestedUnboundedQuantifier('(a+)+')).toBe(true);
    expect(hasNestedUnboundedQuantifier('(a*)*')).toBe(true);
    expect(hasNestedUnboundedQuantifier('(\\s*\\w*)*')).toBe(true);
    expect(hasNestedUnboundedQuantifier('([a-z]+\\d*){2,}')).toBe(true);
    expect(hasNestedUnboundedQuantifier('(x{1,}){3,}')).toBe(true);
  });

  it('does not flag safe patterns', () => {
    expect(hasNestedUnboundedQuantifier('EMP-\\d{6}')).toBe(false);
    expect(hasNestedUnboundedQuantifier('(foo|bar)+')).toBe(false);
    expect(hasNestedUnboundedQuantifier('(a+)')).toBe(false);
    expect(hasNestedUnboundedQuantifier('(a+){1,4}')).toBe(false);
    expect(hasNestedUnboundedQuantifier('[+*]+')).toBe(false);
    expect(hasNestedUnboundedQuantifier('\\(\\+\\)+')).toBe(false);
  });

  it('rejects a redos-shaped custom pattern at load and keeps logging working', () => {
    const cfg = resolveRedaction({ ...noFp, customPatterns: [{ name: 'evil', pattern: '(a+)+$' }] });
    expect(cfg.customPatterns).toHaveLength(0);
    expect(cfg.warnings.join(' ')).toMatch(/redos risk/);
    const start = performance.now();
    expect(redactText(`${'a'.repeat(40)}b`, cfg).text).toBe(`${'a'.repeat(40)}b`);
    expect(performance.now() - start).toBeLessThan(500);
  });

  it('rejects a redos-shaped allowlist regex', () => {
    const cfg = resolveRedaction({ ...noFp, allowlist: ['/(a+)+$/'] });
    expect(cfg.warnings.join(' ')).toMatch(/nested unbounded quantifier/);
  });
});

describe('resolveRedaction', () => {
  it('is idempotent on an already-resolved config', () => {
    const once = resolveRedaction({ categories: { ip: true } });
    expect(resolveRedaction(once)).toBe(once);
  });

  it('treats null and undefined as defaults', () => {
    expect(resolveRedaction(null).enabled).toBe(true);
    expect(resolveRedaction(undefined).enabled).toBe(true);
  });
});
