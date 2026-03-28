import { describe, it, expect } from 'vitest';

import { defaultConfig } from '../../config.js';
import { formatSummary, formatAppDetail, severityIcon } from '../../reporters/cli.js';
import type { Finding, DepsCache } from '../../types.js';

function makeFinding(overrides: Partial<Finding> = {}): Finding {
  return {
    appName: 'test-app', source: 'npm', severity: 'medium',
    category: 'outdated-dep', title: 'react 18 -> 19', detail: 'update available',
    fixable: true, updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeCache(findings: Finding[] = []): DepsCache {
  return {
    version: 1, lastScan: new Date().toISOString(), scanDurationMs: 1000,
    findings, errors: [], config: defaultConfig(),
  };
}

describe('severityIcon', () => {
  it('returns different icons for each severity', () => {
    const icons = new Set([
      severityIcon('critical'),
      severityIcon('high'),
      severityIcon('medium'),
      severityIcon('low'),
      severityIcon('info'),
    ]);
    expect(icons.size).toBe(5);
  });
});

describe('formatSummary', () => {
  it('shows up-to-date message for no findings', () => {
    const lines = formatSummary(makeCache(), 10);
    expect(lines.join('\n')).toContain('up to date');
  });

  it('shows app rows for findings', () => {
    const cache = makeCache([
      makeFinding({ appName: 'app-a', severity: 'critical' }),
      makeFinding({ appName: 'app-a', severity: 'medium' }),
      makeFinding({ appName: 'app-b', severity: 'low' }),
    ]);
    const output = lines(formatSummary(cache, 3));
    expect(output).toContain('app-a');
    expect(output).toContain('app-b');
  });

  it('shows critical section', () => {
    const cache = makeCache([
      makeFinding({ appName: 'hga', severity: 'critical', title: 'CVE-2024-XXXX' }),
    ]);
    const output = lines(formatSummary(cache, 1));
    expect(output).toContain('Critical');
    expect(output).toContain('CVE-2024-XXXX');
  });
});

describe('formatAppDetail', () => {
  it('groups by severity', () => {
    const findings = [
      makeFinding({ severity: 'critical', title: 'crit1' }),
      makeFinding({ severity: 'low', title: 'low1' }),
    ];
    const output = lines(formatAppDetail('test-app', findings));
    expect(output).toContain('crit1');
    expect(output).toContain('low1');
  });

  it('shows up-to-date for no findings', () => {
    const output = lines(formatAppDetail('test-app', []));
    expect(output).toContain('up to date');
  });
});

function lines(arr: string[]): string {
  return arr.join('\n');
}
