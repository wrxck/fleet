import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { buildStatusReport } from './status';

let tmp: string;

describe('backup/status', () => {
  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'fleet-backup-status-'));
    process.env.FLEET_BACKUP_CONFIG_DIR = tmp;
  });
  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
    delete process.env.FLEET_BACKUP_CONFIG_DIR;
  });

  it('returns a report with the expected shape', () => {
    const report = buildStatusReport();
    expect(report).toHaveProperty('generatedAt');
    expect(report).toHaveProperty('backend');
    expect(report).toHaveProperty('appendOnly');
    expect(Array.isArray(report.apps)).toBe(true);
  });
});
