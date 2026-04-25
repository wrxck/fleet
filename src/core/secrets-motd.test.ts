import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./secrets-metadata.js', () => ({ enumerateAllSecrets: vi.fn() }));

import { summariseSecrets, formatSecretsMotd } from './secrets-motd.js';
import { enumerateAllSecrets } from './secrets-metadata.js';

const stripAnsi = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, '');

describe('summariseSecrets', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns zero-stale summary when nothing is stale', () => {
    vi.mocked(enumerateAllSecrets).mockReturnValue([
      mkSecret({ app: 'a', name: 'X', stale: false, sensitivity: 'critical' }),
      mkSecret({ app: 'b', name: 'Y', stale: false, sensitivity: 'high' }),
    ]);
    const s = summariseSecrets();
    expect(s.totalSecrets).toBe(2);
    expect(s.staleCount).toBe(0);
    expect(s.appsWithStale).toEqual([]);
  });

  it('aggregates stale by sensitivity', () => {
    vi.mocked(enumerateAllSecrets).mockReturnValue([
      mkSecret({ app: 'a', name: 'X', stale: true, sensitivity: 'critical' }),
      mkSecret({ app: 'a', name: 'Y', stale: true, sensitivity: 'high' }),
      mkSecret({ app: 'b', name: 'Z', stale: true, sensitivity: 'medium' }),
      mkSecret({ app: 'c', name: 'OK', stale: false, sensitivity: 'critical' }),
    ]);
    const s = summariseSecrets();
    expect(s.staleCount).toBe(3);
    expect(s.bySensitivity.critical).toBe(1);
    expect(s.bySensitivity.high).toBe(1);
    expect(s.bySensitivity.medium).toBe(1);
    expect(s.appsWithStale).toEqual(['a', 'b']);
  });

  it('topStale prioritises critical, then by age desc', () => {
    vi.mocked(enumerateAllSecrets).mockReturnValue([
      mkSecret({ app: 'a', name: 'OLD-MED', stale: true, sensitivity: 'medium', ageDays: 500 }),
      mkSecret({ app: 'b', name: 'NEW-CRIT', stale: true, sensitivity: 'critical', ageDays: 100 }),
      mkSecret({ app: 'c', name: 'OLD-CRIT', stale: true, sensitivity: 'critical', ageDays: 200 }),
    ]);
    const s = summariseSecrets();
    expect(s.topStale.map(t => t.name)).toEqual(['OLD-CRIT', 'NEW-CRIT', 'OLD-MED']);
  });
});

describe('formatSecretsMotd', () => {
  it('reports clean state', () => {
    const out = formatSecretsMotd({
      totalSecrets: 50,
      staleCount: 0,
      bySensitivity: { critical: 0, high: 0, medium: 0, low: 0 },
      appsWithStale: [],
      topStale: [],
    });
    expect(stripAnsi(out)).toMatch(/All 50 secrets within rotation/);
  });

  it('reports stale state with prefixes', () => {
    const out = formatSecretsMotd({
      totalSecrets: 100,
      staleCount: 4,
      bySensitivity: { critical: 2, high: 1, medium: 1, low: 0 },
      appsWithStale: ['macpool', 'shiftfaced'],
      topStale: [
        { app: 'macpool', name: 'STRIPE_SECRET_KEY', ageDays: 200, sensitivity: 'critical' },
        { app: 'macpool', name: 'STRIPE_WEBHOOK_SECRET', ageDays: 100, sensitivity: 'high' },
      ],
    });
    const clean = stripAnsi(out);
    expect(clean).toMatch(/4 secrets need rotation \(2 critical, 1 high, 1 medium\)/);
    expect(clean).toMatch(/!! macpool: STRIPE_SECRET_KEY \(200d old\)/);
    expect(clean).toMatch(/ ! macpool: STRIPE_WEBHOOK_SECRET \(100d old\)/);
    expect(clean).toMatch(/Run: fleet secrets ages --stale-only/);
  });
});

function mkSecret(o: { app: string; name: string; stale: boolean; sensitivity: any; ageDays?: number }) {
  return {
    app: o.app,
    name: o.name,
    maskedValue: '***',
    lastRotated: new Date().toISOString(),
    ageDays: o.ageDays ?? 0,
    stale: o.stale,
    provider: {
      id: 'x',
      matches: /x/,
      name: 'X',
      sensitivity: o.sensitivity,
      rotationFrequencyDays: 90,
      strategy: 'immediate' as const,
    },
  };
}
