import { describe, it, expect } from 'vitest';

import { defaultConfig } from '../../config.js';
import { formatMotd, generateMotdScript } from '../../reporters/motd.js';
import type { Finding, DepsCache } from '../../types.js';

function makeFinding(overrides: Partial<Finding> = {}): Finding {
  return {
    appName: 'test-app', source: 'npm', severity: 'medium',
    category: 'outdated-dep', title: 'react 18 -> 19', detail: 'update',
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

describe('formatMotd', () => {
  it('shows up-to-date for no findings', () => {
    const output = formatMotd(makeCache(), 10);
    expect(output).toContain('up to date');
    expect(output).toContain('Fleet Deps');
  });

  it('shows critical findings prominently', () => {
    const cache = makeCache([
      makeFinding({ appName: 'hga', severity: 'critical', title: 'CVE-2024-XXXXX' }),
      makeFinding({ appName: 'zmb', severity: 'low' }),
    ]);
    const output = formatMotd(cache, 10);
    expect(output).toContain('1 critical');
    expect(output).toContain('hga');
    expect(output).toContain('CVE-2024-XXXXX');
  });

  it('limits urgent findings to 5', () => {
    const findings = Array.from({ length: 10 }, (_, i) =>
      makeFinding({ appName: `app-${i}`, severity: 'critical', title: `crit-${i}` })
    );
    const output = formatMotd(makeCache(findings), 15);
    const critLines = output.split('\n').filter(l => l.includes('!!'));
    expect(critLines.length).toBeLessThanOrEqual(5);
  });

  it('shows healthy app count', () => {
    const cache = makeCache([makeFinding({ appName: 'hga' })]);
    const output = formatMotd(cache, 10);
    expect(output).toContain('9 apps fully up to date');
  });
});

describe('generateMotdScript', () => {
  it('generates a bash script', () => {
    const script = generateMotdScript('/var/lib/fleet/deps-cache.json');
    expect(script).toContain('#!/bin/bash');
    expect(script).toContain('deps-cache.json');
    expect(script).toContain('fleet deps');
  });
});
