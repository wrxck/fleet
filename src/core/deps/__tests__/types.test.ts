import { describe, it, expect } from 'vitest';
import type {
  CollectorType,
  Severity,
  FindingCategory,
  Finding,
  ScanError,
  IgnoreRule,
  DepsConfig,
  DepsCache,
} from '../types.js';

describe('Finding', () => {
  it('accepts required fields only', () => {
    const finding: Finding = {
      appName: 'my-app',
      source: 'npm',
      severity: 'high',
      category: 'outdated-dep',
      title: 'lodash is outdated',
      detail: 'lodash 4.17.20 is behind latest 4.17.21',
      fixable: true,
      updatedAt: '2026-03-28T00:00:00.000Z',
    };

    expect(finding.appName).toBe('my-app');
    expect(finding.source).toBe('npm');
    expect(finding.severity).toBe('high');
    expect(finding.category).toBe('outdated-dep');
    expect(finding.fixable).toBeTruthy();
    expect(finding.package).toBeUndefined();
    expect(finding.currentVersion).toBeUndefined();
    expect(finding.latestVersion).toBeUndefined();
    expect(finding.eolDate).toBeUndefined();
    expect(finding.cveId).toBeUndefined();
    expect(finding.prUrl).toBeUndefined();
  });

  it('accepts all optional fields', () => {
    const finding: Finding = {
      appName: 'my-app',
      source: 'vulnerability',
      severity: 'critical',
      category: 'vulnerability',
      title: 'CVE-2024-1234 in express',
      detail: 'Remote code execution vulnerability in express < 4.19.0',
      package: 'express',
      currentVersion: '4.18.0',
      latestVersion: '4.19.2',
      eolDate: '2025-01-01',
      cveId: 'CVE-2024-1234',
      prUrl: 'https://github.com/org/repo/pull/42',
      fixable: true,
      updatedAt: '2026-03-28T00:00:00.000Z',
    };

    expect(finding.package).toBe('express');
    expect(finding.currentVersion).toBe('4.18.0');
    expect(finding.latestVersion).toBe('4.19.2');
    expect(finding.eolDate).toBe('2025-01-01');
    expect(finding.cveId).toBe('CVE-2024-1234');
    expect(finding.prUrl).toBe('https://github.com/org/repo/pull/42');
  });
});

describe('DepsCache', () => {
  it('accepts empty findings and errors', () => {
    const config: DepsConfig = {
      scanIntervalHours: 24,
      concurrency: 4,
      notifications: {
        telegram: {
          enabled: false,
          chatId: '',
          minSeverity: 'high',
        },
      },
      ignore: [],
      severityOverrides: {
        eolDaysWarning: 90,
        majorVersionBehind: 'high',
        minorVersionBehind: 'medium',
        patchVersionBehind: 'low',
      },
      osvSkipPatterns: [],
    };

    const cache: DepsCache = {
      version: 1,
      lastScan: '2026-03-28T00:00:00.000Z',
      scanDurationMs: 1500,
      findings: [],
      errors: [],
      config,
    };

    expect(cache.version).toBe(1);
    expect(cache.findings).toHaveLength(0);
    expect(cache.errors).toHaveLength(0);
    expect(cache.scanDurationMs).toBe(1500);
  });

  it('accepts multiple findings and errors', () => {
    const finding: Finding = {
      appName: 'app-a',
      source: 'docker-image',
      severity: 'medium',
      category: 'image-update',
      title: 'New image available',
      detail: 'node:18-alpine has a newer version',
      fixable: false,
      updatedAt: '2026-03-28T00:00:00.000Z',
    };

    const error: ScanError = {
      collector: 'composer',
      appName: 'app-b',
      message: 'composer.json not found',
      timestamp: '2026-03-28T00:00:00.000Z',
    };

    const config: DepsConfig = {
      scanIntervalHours: 12,
      concurrency: 2,
      notifications: {
        telegram: {
          enabled: true,
          chatId: '-1001234567890',
          minSeverity: 'critical',
        },
      },
      ignore: [],
      severityOverrides: {
        eolDaysWarning: 60,
        majorVersionBehind: 'critical',
        minorVersionBehind: 'high',
        patchVersionBehind: 'info',
      },
      osvSkipPatterns: ['^@matthesketh/'],
    };

    const cache: DepsCache = {
      version: 1,
      lastScan: '2026-03-28T00:00:00.000Z',
      scanDurationMs: 3200,
      findings: [finding],
      errors: [error],
      config,
    };

    expect(cache.findings).toHaveLength(1);
    expect(cache.errors).toHaveLength(1);
    expect(cache.findings[0].source).toBe('docker-image');
    expect(cache.errors[0].collector).toBe('composer');
  });
});

describe('ScanError', () => {
  it('accepts required fields only', () => {
    const err: ScanError = {
      collector: 'pip',
      message: 'requirements.txt parse error',
      timestamp: '2026-03-28T00:00:00.000Z',
    };

    expect(err.collector).toBe('pip');
    expect(err.message).toBe('requirements.txt parse error');
    expect(err.appName).toBeUndefined();
  });

  it('accepts optional appName', () => {
    const err: ScanError = {
      collector: 'github-pr',
      appName: 'my-app',
      message: 'GitHub API rate limit exceeded',
      timestamp: '2026-03-28T00:00:00.000Z',
    };

    expect(err.appName).toBe('my-app');
  });
});

describe('CollectorType', () => {
  it('covers all expected values', () => {
    const collectors: CollectorType[] = [
      'npm',
      'composer',
      'pip',
      'docker-image',
      'docker-running',
      'eol',
      'vulnerability',
      'github-pr',
    ];

    expect(collectors).toHaveLength(8);
    expect(collectors).toContain('npm');
    expect(collectors).toContain('composer');
    expect(collectors).toContain('pip');
    expect(collectors).toContain('docker-image');
    expect(collectors).toContain('docker-running');
    expect(collectors).toContain('eol');
    expect(collectors).toContain('vulnerability');
    expect(collectors).toContain('github-pr');
  });
});

describe('IgnoreRule', () => {
  it('accepts reason-only rule', () => {
    const rule: IgnoreRule = {
      reason: 'internal package, no public releases',
    };

    expect(rule.reason).toBe('internal package, no public releases');
    expect(rule.appName).toBeUndefined();
    expect(rule.package).toBeUndefined();
    expect(rule.source).toBeUndefined();
    expect(rule.until).toBeUndefined();
  });

  it('accepts fully specified rule', () => {
    const rule: IgnoreRule = {
      appName: 'my-app',
      package: 'lodash',
      source: 'npm',
      reason: 'pinned for compatibility',
      until: '2026-06-01',
    };

    expect(rule.appName).toBe('my-app');
    expect(rule.package).toBe('lodash');
    expect(rule.source).toBe('npm');
    expect(rule.until).toBe('2026-06-01');
  });
});
