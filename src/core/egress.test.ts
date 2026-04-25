import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./exec.js', () => ({ execSafe: vi.fn() }));

import { snapshotEgress, addEgressAllow } from './egress.js';
import { execSafe } from './exec.js';
import type { AppEntry } from './registry.js';

function app(overrides: Partial<AppEntry> = {}): AppEntry {
  return {
    name: 'macpool',
    displayName: 'macpool',
    composePath: '/x',
    composeFile: null,
    serviceName: 'macpool',
    domains: [],
    port: null,
    usesSharedDb: false,
    type: 'nextjs',
    containers: ['macpool'],
    dependsOnDatabases: false,
    registeredAt: '',
    ...overrides,
  };
}

const mockExec = vi.mocked(execSafe);

function mockSequence(results: Array<{ ok: boolean; stdout: string }>) {
  let i = 0;
  mockExec.mockImplementation(() => {
    const r = results[i++] ?? { ok: false, stdout: '' };
    return { ...r, stderr: '' };
  });
}

describe('snapshotEgress', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns empty when no containers running', () => {
    mockSequence([{ ok: false, stdout: '' }]);
    const snap = snapshotEgress(app());
    expect(snap.flows).toHaveLength(0);
    expect(snap.uniqueRemotes).toHaveLength(0);
  });

  it('parses ss output and dedupes uniqueRemotes', () => {
    mockSequence([
      { ok: true, stdout: '1234' },
      { ok: true, stdout: 'ESTAB 0 0 172.20.0.5:34000 1.2.3.4:443\nESTAB 0 0 172.20.0.5:34002 1.2.3.4:443' },
      { ok: false, stdout: '' },
      { ok: false, stdout: '' },
    ]);
    const snap = snapshotEgress(app());
    expect(snap.flows.length).toBeGreaterThan(0);
    expect(snap.uniqueRemotes).toEqual(['1.2.3.4:443']);
  });

  it('flags non-private destinations not in allowlist as violations', () => {
    mockSequence([
      { ok: true, stdout: '1234' },
      { ok: true, stdout: 'ESTAB 0 0 172.20.0.5:34000 8.8.8.8:443' },
      { ok: false, stdout: '' },
      { ok: false, stdout: '' },
    ]);
    const snap = snapshotEgress(app({ egress: { allow: ['api.stripe.com:443'] } }));
    expect(snap.violations).toEqual(['8.8.8.8:443']);
  });

  it('does not flag RFC1918 destinations', () => {
    mockSequence([
      { ok: true, stdout: '1234' },
      { ok: true, stdout: 'ESTAB 0 0 172.20.0.5:34000 10.0.0.5:5432' },
      { ok: false, stdout: '' },
      { ok: false, stdout: '' },
    ]);
    expect(snapshotEgress(app({ egress: { allow: [] } })).violations).toEqual([]);
  });

  it('respects host:port allowlist exactly', () => {
    mockSequence([
      { ok: true, stdout: '1234' },
      { ok: true, stdout: 'ESTAB 0 0 172.20.0.5:34000 8.8.8.8:443' },
      { ok: true, stdout: '8.8.8.8     dns.google' },
    ]);
    expect(snapshotEgress(app({ egress: { allow: ['dns.google'] } })).violations).toEqual([]);
  });

  it('supports *.host wildcard', () => {
    mockSequence([
      { ok: true, stdout: '1234' },
      { ok: true, stdout: 'ESTAB 0 0 172.20.0.5:34000 1.2.3.4:443' },
      { ok: true, stdout: '1.2.3.4     api.stripe.com' },
    ]);
    expect(snapshotEgress(app({ egress: { allow: ['*.stripe.com'] } })).violations).toEqual([]);
  });
});

describe('addEgressAllow', () => {
  it('seeds an empty allowlist', () => {
    const a = app();
    addEgressAllow(a, 'api.stripe.com');
    expect(a.egress?.allow).toEqual(['api.stripe.com']);
  });
  it('dedupes', () => {
    const a = app({ egress: { allow: ['x.com'] } });
    addEgressAllow(a, 'x.com');
    expect(a.egress?.allow).toEqual(['x.com']);
  });
  it('keeps allowlist sorted', () => {
    const a = app();
    addEgressAllow(a, 'z.com');
    addEgressAllow(a, 'a.com');
    addEgressAllow(a, 'm.com');
    expect(a.egress?.allow).toEqual(['a.com', 'm.com', 'z.com']);
  });
});
