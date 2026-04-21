import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { openDb, closeDb, currentSchemaVersion } from './db.js';

describe('openDb', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'fleet-db-'));
  });

  afterEach(() => {
    closeDb();
    rmSync(dir, { recursive: true, force: true });
  });

  it('creates schema on first open', () => {
    const db = openDb({ path: join(dir, 'fleet.db') });
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all() as { name: string }[];
    const names = tables.map(t => t.name);
    expect(names).toContain('routine_runs');
    expect(names).toContain('routine_run_events');
    expect(names).toContain('routine_cost');
    expect(names).toContain('signal_cache');
    expect(names).toContain('signal_history');
  });

  it('sets current schema version', () => {
    const db = openDb({ path: join(dir, 'fleet.db') });
    const row = db.prepare('SELECT version FROM schema_version').get() as { version: number };
    expect(row.version).toBe(currentSchemaVersion());
  });

  it('migrations are idempotent on reopen', () => {
    openDb({ path: join(dir, 'fleet.db') });
    closeDb();
    const db = openDb({ path: join(dir, 'fleet.db') });
    const count = db.prepare('SELECT COUNT(*) AS c FROM schema_version').get() as { c: number };
    expect(count.c).toBe(1);
  });

  it('enforces foreign keys', () => {
    const db = openDb({ path: join(dir, 'fleet.db') });
    expect(() =>
      db.prepare(
        'INSERT INTO routine_run_events(run_id, seq, at, kind, payload) VALUES (?, ?, ?, ?, ?)',
      ).run('nonexistent-run', 0, new Date().toISOString(), 'start', '{}'),
    ).toThrow();
  });
});
