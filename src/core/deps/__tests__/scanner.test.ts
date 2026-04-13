import { describe, it, expect, vi } from 'vitest';

import { defaultConfig } from '../config.js';
import { runScan } from '../scanner.js';
import type { AppEntry } from '../../registry.js';
import type { Collector, Finding } from '../types.js';

function makeApp(name: string): AppEntry {
  return {
    name, displayName: name, composePath: `/opt/apps/${name}`,
    composeFile: null, serviceName: name, domains: [], port: 3000,
    usesSharedDb: false, type: 'service', containers: [name],
    dependsOnDatabases: false, registeredAt: '2026-01-01T00:00:00Z',
  };
}

function makeFinding(appName: string, source: string, pkg?: string): Finding {
  return {
    appName, source: source as Finding['source'], severity: 'medium',
    category: 'outdated-dep', title: 'test finding', detail: 'test',
    fixable: true, updatedAt: new Date().toISOString(),
    ...(pkg && { package: pkg }),
  };
}

describe('runScan', () => {
  it('runs collectors against matching apps and returns cache', async () => {
    const mockCollector: Collector = {
      type: 'npm',
      detect: vi.fn().mockReturnValue(true),
      collect: vi.fn().mockResolvedValue([makeFinding('app-a', 'npm')]),
    };

    const cache = await runScan([makeApp('app-a')], defaultConfig(), [mockCollector]);
    expect(cache.findings).toHaveLength(1);
    expect(cache.errors).toHaveLength(0);
    expect(mockCollector.collect).toHaveBeenCalledTimes(1);
  });

  it('skips collectors that do not detect for an app', async () => {
    const mockCollector: Collector = {
      type: 'composer',
      detect: vi.fn().mockReturnValue(false),
      collect: vi.fn(),
    };

    const cache = await runScan([makeApp('app-a')], defaultConfig(), [mockCollector]);
    expect(cache.findings).toHaveLength(0);
    expect(mockCollector.collect).not.toHaveBeenCalled();
  });

  it('captures errors from failing collectors', async () => {
    const mockCollector: Collector = {
      type: 'npm',
      detect: vi.fn().mockReturnValue(true),
      collect: vi.fn().mockRejectedValue(new Error('Network timeout')),
    };

    const cache = await runScan([makeApp('app-a')], defaultConfig(), [mockCollector]);
    expect(cache.findings).toHaveLength(0);
    expect(cache.errors).toHaveLength(1);
    expect(cache.errors[0].message).toBe('Network timeout');
  });

  it('applies ignore rules', async () => {
    const mockCollector: Collector = {
      type: 'npm',
      detect: vi.fn().mockReturnValue(true),
      collect: vi.fn().mockResolvedValue([
        makeFinding('app-a', 'npm', 'react'),
        makeFinding('app-a', 'npm', 'express'),
      ]),
    };

    const config = {
      ...defaultConfig(),
      ignore: [{ package: 'react', reason: 'waiting for ecosystem' }],
    };

    const cache = await runScan([makeApp('app-a')], config, [mockCollector]);
    expect(cache.findings).toHaveLength(1);
    expect(cache.findings[0].package).toBe('express');
  });

  it('respects expired ignore rules', async () => {
    const mockCollector: Collector = {
      type: 'npm',
      detect: vi.fn().mockReturnValue(true),
      collect: vi.fn().mockResolvedValue([makeFinding('app-a', 'npm', 'react')]),
    };

    const config = {
      ...defaultConfig(),
      ignore: [{ package: 'react', reason: 'test', until: '2020-01-01' }],
    };

    const cache = await runScan([makeApp('app-a')], config, [mockCollector]);
    expect(cache.findings).toHaveLength(1);
  });

  it('populates cache metadata', async () => {
    const mockCollector: Collector = {
      type: 'npm',
      detect: vi.fn().mockReturnValue(true),
      collect: vi.fn().mockResolvedValue([]),
    };

    const cache = await runScan([makeApp('app-a')], defaultConfig(), [mockCollector]);
    expect(cache.version).toBe(1);
    expect(cache.lastScan).toBeTruthy();
    expect(cache.scanDurationMs).toBeGreaterThanOrEqual(0);
  });
});
