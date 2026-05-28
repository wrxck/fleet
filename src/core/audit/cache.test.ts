import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { loadAuditCache, saveAuditRecord } from './cache';
import type { AuditRecord } from './types';

const tmpDirs: string[] = [];

function tmpCachePath(): string {
  const dir = mkdtempSync(join(tmpdir(), 'fleet-audit-'));
  tmpDirs.push(dir);
  return join(dir, 'audit-cache.json');
}

afterEach(() => {
  for (const dir of tmpDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function record(target: string): AuditRecord {
  return {
    target,
    projectPath: `/p/${target}`,
    ranAt: '2026-05-17T00:00:00.000Z',
    report: {
      project_path: `/p/${target}`,
      has_privacy_info: true,
      findings: [],
      summary: { total: 0, critical: 0, warns: 0, infos: 0, passed: true },
      elapsed: '5ms',
    },
  };
}

describe('audit cache', () => {
  it('returns an empty cache when the file is absent', () => {
    expect(loadAuditCache(tmpCachePath())).toEqual({ version: 1, audits: {} });
  });

  it('round-trips a saved record', () => {
    const path = tmpCachePath();
    saveAuditRecord(record('alpha'), path);
    expect(loadAuditCache(path).audits.alpha.projectPath).toBe('/p/alpha');
  });

  it('upserts by target without dropping other records', () => {
    const path = tmpCachePath();
    saveAuditRecord(record('alpha'), path);
    saveAuditRecord(record('beta'), path);
    expect(Object.keys(loadAuditCache(path).audits).sort()).toEqual(['alpha', 'beta']);
  });

  it('overwrites an earlier record for the same target', () => {
    const path = tmpCachePath();
    saveAuditRecord(record('alpha'), path);
    const updated = { ...record('alpha'), ranAt: '2026-05-17T09:00:00.000Z' };
    saveAuditRecord(updated, path);
    const cache = loadAuditCache(path);
    expect(Object.keys(cache.audits)).toEqual(['alpha']);
    expect(cache.audits.alpha.ranAt).toBe('2026-05-17T09:00:00.000Z');
  });

  it('returns an empty cache when the file is corrupt', () => {
    const path = tmpCachePath();
    writeFileSync(path, '{ not json');
    expect(loadAuditCache(path)).toEqual({ version: 1, audits: {} });
  });
});
