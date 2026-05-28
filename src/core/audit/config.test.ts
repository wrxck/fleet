import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { loadAuditConfig, saveAuditConfig, defaultAuditConfig } from './config';

const tmpDirs: string[] = [];

function tmpConfigPath(): string {
  const dir = mkdtempSync(join(tmpdir(), 'fleet-audit-cfg-'));
  tmpDirs.push(dir);
  return join(dir, 'audit-config.json');
}

afterEach(() => {
  for (const dir of tmpDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('audit config', () => {
  it('returns the default config when the file is absent', () => {
    expect(loadAuditConfig(tmpConfigPath())).toEqual({ version: 1, ignore: [] });
  });

  it('round-trips ignore rules', () => {
    const path = tmpConfigPath();
    saveAuditConfig(
      { version: 1, ignore: [{ title: 'X', reason: 'fp', addedAt: '2026-05-17T00:00:00.000Z' }] },
      path,
    );
    expect(loadAuditConfig(path).ignore[0].title).toBe('X');
  });

  it('returns the default config when the file is corrupt', () => {
    const path = tmpConfigPath();
    writeFileSync(path, 'not json');
    expect(loadAuditConfig(path)).toEqual(defaultAuditConfig());
  });

  it('returns the default config when ignore is not an array', () => {
    const path = tmpConfigPath();
    writeFileSync(path, JSON.stringify({ version: 1, ignore: 'nope' }));
    expect(loadAuditConfig(path).ignore).toEqual([]);
  });
});
