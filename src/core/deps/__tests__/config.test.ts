import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { defaultConfig, mergeConfig, loadConfig, saveConfig } from '../config.js';
import type { DepsConfig } from '../types.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'fleet-deps-config-test-'));
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('defaultConfig', () => {
  it('returns sensible defaults', () => {
    const config = defaultConfig();

    expect(config.scanIntervalHours).toBe(6);
    expect(config.concurrency).toBe(5);
    expect(config.notifications.telegram.enabled).toBeTruthy();
    expect(config.notifications.telegram.minSeverity).toBe('info');
    expect(config.notifications.telegram.chatId).toBe('');
    expect(config.ignore).toEqual([]);
    expect(config.severityOverrides.eolDaysWarning).toBe(90);
    expect(config.severityOverrides.majorVersionBehind).toBe('high');
    expect(config.severityOverrides.minorVersionBehind).toBe('medium');
    expect(config.severityOverrides.patchVersionBehind).toBe('low');
    // Privacy: do not leak the user's own scope to api.osv.dev.
    expect(config.osvSkipPatterns).toEqual(['^@matthesketh/']);
  });
});

describe('loadConfig', () => {
  it('returns defaults when file is missing', () => {
    const missingPath = join(tmpDir, 'nonexistent', 'config.json');
    const config = loadConfig(missingPath);
    expect(config).toEqual(defaultConfig());
  });

  it('parses an existing config file', () => {
    const filePath = join(tmpDir, 'config.json');
    const stored: DepsConfig = {
      scanIntervalHours: 12,
      concurrency: 3,
      notifications: {
        telegram: {
          enabled: false,
          chatId: '-1001234567890',
          minSeverity: 'high',
        },
      },
      ignore: [{ reason: 'internal only' }],
      severityOverrides: {
        eolDaysWarning: 60,
        majorVersionBehind: 'critical',
        minorVersionBehind: 'high',
        patchVersionBehind: 'info',
      },
      osvSkipPatterns: ['^@matthesketh/'],
    };
    writeFileSync(filePath, JSON.stringify(stored, null, 2));

    const config = loadConfig(filePath);
    expect(config.scanIntervalHours).toBe(12);
    expect(config.concurrency).toBe(3);
    expect(config.notifications.telegram.enabled).toBeFalsy();
    expect(config.notifications.telegram.chatId).toBe('-1001234567890');
    expect(config.notifications.telegram.minSeverity).toBe('high');
    expect(config.ignore).toHaveLength(1);
    expect(config.severityOverrides.eolDaysWarning).toBe(60);
  });

  it('merges partial config with defaults', () => {
    const filePath = join(tmpDir, 'partial.json');
    const partial = { scanIntervalHours: 24 };
    writeFileSync(filePath, JSON.stringify(partial));

    const config = loadConfig(filePath);
    expect(config.scanIntervalHours).toBe(24);
    expect(config.concurrency).toBe(5);
    expect(config.notifications.telegram.enabled).toBeTruthy();
    expect(config.notifications.telegram.minSeverity).toBe('info');
    expect(config.ignore).toEqual([]);
    expect(config.severityOverrides.eolDaysWarning).toBe(90);
    // Backwards compat: an old config without osvSkipPatterns should still
    // get the default (skip the user's own scope).
    expect(config.osvSkipPatterns).toEqual(['^@matthesketh/']);
  });
});

describe('saveConfig', () => {
  it('writes config to disk', () => {
    const filePath = join(tmpDir, 'saved.json');
    const config = defaultConfig();
    config.scanIntervalHours = 48;

    saveConfig(config, filePath);

    const raw = readFileSync(filePath, 'utf-8');
    const parsed = JSON.parse(raw) as DepsConfig;
    expect(parsed.scanIntervalHours).toBe(48);
    expect(parsed.concurrency).toBe(5);
  });

  it('creates parent directories if needed', () => {
    const filePath = join(tmpDir, 'nested', 'deep', 'config.json');
    const config = defaultConfig();

    saveConfig(config, filePath);

    const raw = readFileSync(filePath, 'utf-8');
    const parsed = JSON.parse(raw) as DepsConfig;
    expect(parsed.scanIntervalHours).toBe(6);
  });
});

describe('mergeConfig', () => {
  it('deep merges nested objects', () => {
    const base = defaultConfig();
    const overrides = {
      scanIntervalHours: 12,
      notifications: {
        telegram: {
          enabled: false,
          chatId: '-9999',
        },
      },
    };

    const merged = mergeConfig(base, overrides);

    expect(merged.scanIntervalHours).toBe(12);
    expect(merged.concurrency).toBe(5);
    expect(merged.notifications.telegram.enabled).toBe(false);
    expect(merged.notifications.telegram.chatId).toBe('-9999');
    expect(merged.notifications.telegram.minSeverity).toBe('info');
    expect(merged.severityOverrides.eolDaysWarning).toBe(90);
  });

  it('does not mutate the base config', () => {
    const base = defaultConfig();
    const overrides = { scanIntervalHours: 99 };

    mergeConfig(base, overrides);

    expect(base.scanIntervalHours).toBe(6);
  });
});
