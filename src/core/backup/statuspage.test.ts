import { describe, it, expect } from 'vitest';

import {
  healthOf,
  humanBytes,
  relativeTime,
  renderStatusHtml,
  StatusEntry,
  StatusReport,
} from './statuspage';

const NOW = Date.parse('2026-05-15T12:00:00Z');

function entry(over: Partial<StatusEntry> = {}): StatusEntry {
  return {
    app: 'demo',
    schedule: 'daily',
    disabled: false,
    snapshotCount: 1,
    lastSnapshotAt: new Date(NOW - 3_600_000).toISOString(),
    totalSize: 1024,
    ...over,
  };
}

describe('healthOf', () => {
  it('ok when recent', () => {
    expect(healthOf(entry(), NOW)).toBe('ok');
  });

  it('missing when no snapshot', () => {
    expect(healthOf(entry({ lastSnapshotAt: null, snapshotCount: 0 }), NOW)).toBe('missing');
  });

  it('disabled overrides everything', () => {
    expect(healthOf(entry({ disabled: true, lastSnapshotAt: null }), NOW)).toBe('disabled');
  });

  it('stale when a daily backup is 2 days old', () => {
    const old = new Date(NOW - 48 * 3_600_000).toISOString();
    expect(healthOf(entry({ schedule: 'daily', lastSnapshotAt: old }), NOW)).toBe('stale');
  });

  it('hourly stays ok at 2h, stale at 4h', () => {
    expect(healthOf(entry({ schedule: 'hourly', lastSnapshotAt: new Date(NOW - 2 * 3.6e6).toISOString() }), NOW)).toBe('ok');
    expect(healthOf(entry({ schedule: 'hourly', lastSnapshotAt: new Date(NOW - 4 * 3.6e6).toISOString() }), NOW)).toBe('stale');
  });

  it('weekly tolerates a week-old snapshot', () => {
    const sixDays = new Date(NOW - 6 * 24 * 3.6e6).toISOString();
    expect(healthOf(entry({ schedule: 'weekly', lastSnapshotAt: sixDays }), NOW)).toBe('ok');
  });
});

describe('humanBytes', () => {
  it('formats across scales', () => {
    expect(humanBytes(null)).toBe('—');
    expect(humanBytes(512)).toBe('512 B');
    expect(humanBytes(2048)).toBe('2.0 KB');
    expect(humanBytes(5 * 1024 ** 2)).toBe('5.0 MB');
    expect(humanBytes(3 * 1024 ** 3)).toBe('3.00 GB');
  });
});

describe('relativeTime', () => {
  it('handles never / minutes / hours / days', () => {
    expect(relativeTime(null, NOW)).toBe('never');
    expect(relativeTime(new Date(NOW - 30_000).toISOString(), NOW)).toBe('just now');
    expect(relativeTime(new Date(NOW - 5 * 60_000).toISOString(), NOW)).toBe('5m ago');
    expect(relativeTime(new Date(NOW - 3 * 3.6e6).toISOString(), NOW)).toBe('3h ago');
    expect(relativeTime(new Date(NOW - 3 * 24 * 3.6e6).toISOString(), NOW)).toBe('3d ago');
  });
});

describe('renderStatusHtml', () => {
  const report: StatusReport = {
    generatedAt: '2026-05-15T12:00:00.000Z',
    backend: 'rest',
    appendOnly: true,
    apps: [
      entry({ app: 'zeta' }),
      entry({ app: 'alpha', lastSnapshotAt: null, snapshotCount: 0 }),
    ],
  };

  it('produces a full html document', () => {
    const html = renderStatusHtml(report, NOW);
    expect(html).toContain('<!doctype html>');
    expect(html).toContain('fleet backups');
    expect(html).toContain('append-only enforced');
  });

  it('sorts apps alphabetically', () => {
    const html = renderStatusHtml(report, NOW);
    expect(html.indexOf('alpha')).toBeLessThan(html.indexOf('zeta'));
  });

  it('counts health states in the badges', () => {
    const html = renderStatusHtml(report, NOW);
    expect(html).toContain('<b>1</b> ok');
    expect(html).toContain('<b>1</b> missing');
  });

  it('escapes app names', () => {
    const evil: StatusReport = {
      ...report,
      apps: [entry({ app: '<script>x</script>' })],
    };
    const html = renderStatusHtml(evil, NOW);
    expect(html).not.toContain('<script>x</script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('shows append-only OFF when not enforced', () => {
    const html = renderStatusHtml({ ...report, appendOnly: false }, NOW);
    expect(html).toContain('append-only OFF');
  });
});
