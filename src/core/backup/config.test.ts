import { mkdtempSync, rmSync, writeFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import {
  DEFAULT_RETENTION,
  backupConfigDir,
  loadConfig,
  saveConfig,
  listConfiguredApps,
  validateAppName,
} from './config';

let tmp: string;

describe('backup/config', () => {
  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'fleet-backup-cfg-'));
    process.env.FLEET_BACKUP_CONFIG_DIR = tmp;
  });
  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
    delete process.env.FLEET_BACKUP_CONFIG_DIR;
  });

  it('returns null when no config file exists', () => {
    expect(loadConfig('nope')).toBeNull();
  });

  it('round-trips a config through save+load', () => {
    const cfg = {
      app: 'sample',
      schedule: 'daily' as const,
      paths: ['/var/lib/sample'],
      exclude: ['*.log'],
      retention: DEFAULT_RETENTION,
    };
    saveConfig(cfg);
    expect(loadConfig('sample')).toEqual(cfg);
  });

  it('listConfiguredApps returns sorted slugs', () => {
    for (const app of ['zebra', 'alpha', 'mango']) {
      saveConfig({ app, schedule: 'daily', paths: ['/x'], exclude: [], retention: DEFAULT_RETENTION });
    }
    expect(listConfiguredApps()).toEqual(['alpha', 'mango', 'zebra']);
  });

  it('throws on malformed json', () => {
    writeFileSync(join(tmp, 'busted.json'), '{ "app": "x", "paths": "wrong" }');
    expect(() => loadConfig('busted')).toThrow(/malformed backup config/);
  });

  it('validateAppName accepts real names and rejects bad ones', () => {
    expect(() => validateAppName('shotzandpotz')).not.toThrow();
    expect(() => validateAppName('natures-art-ui')).not.toThrow();
    expect(() => validateAppName('system')).not.toThrow();
    expect(() => validateAppName('')).toThrow();
    expect(() => validateAppName('UPPER')).toThrow();
    expect(() => validateAppName('with spaces')).toThrow();
    expect(() => validateAppName('weird;path')).toThrow();
  });

  it('writes config file mode 600', () => {
    saveConfig({ app: 'permcheck', schedule: 'daily', paths: ['/x'], exclude: [], retention: DEFAULT_RETENTION });
    const stat = statSync(join(backupConfigDir(), 'permcheck.json'));
    expect(stat.mode & 0o777).toBe(0o600);
  });

  it('round-trip preserves preDump and volumes', () => {
    saveConfig({
      app: 'fancy',
      schedule: 'hourly',
      paths: ['/srv/fancy'],
      exclude: [],
      volumes: ['fancy_data'],
      preDump: { type: 'postgres', container: 'fancy-db', db: 'fancy' },
      retention: DEFAULT_RETENTION,
    });
    const got = loadConfig('fancy');
    expect(got?.volumes).toEqual(['fancy_data']);
    expect(got?.preDump?.type).toBe('postgres');
  });
});
