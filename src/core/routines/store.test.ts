import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { type Routine } from './schema.js';
import { RoutineStore } from './store.js';

const mkRoutine = (id: string, overrides: Partial<Routine> = {}): Routine => ({
  id,
  name: `Routine ${id}`,
  description: '',
  schedule: { kind: 'manual' },
  enabled: true,
  targets: [],
  perTarget: false,
  task: { kind: 'shell', argv: ['echo', 'hello'], wallClockMs: 60_000 },
  notify: [],
  tags: [],
  ...overrides,
});

describe('RoutineStore', () => {
  let dir: string;
  let path: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'fleet-store-'));
    path = join(dir, 'routines.json');
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('returns empty list when file is missing', () => {
    const store = new RoutineStore(path);
    expect(store.list()).toEqual([]);
  });

  it('persists an upserted routine atomically', () => {
    const store = new RoutineStore(path);
    store.upsert(mkRoutine('a'));
    expect(existsSync(path)).toBeTruthy();
    const reopened = new RoutineStore(path);
    expect(reopened.list()).toHaveLength(1);
    expect(reopened.list()[0]?.id).toBe('a');
  });

  it('replaces an existing routine on upsert', () => {
    const store = new RoutineStore(path);
    store.upsert(mkRoutine('a', { name: 'first' }));
    store.upsert(mkRoutine('a', { name: 'second' }));
    expect(store.list()).toHaveLength(1);
    expect(store.list()[0]?.name).toBe('second');
  });

  it('stamps createdAt on first write and preserves it on update', async () => {
    const store = new RoutineStore(path);
    const first = store.upsert(mkRoutine('a'));
    await new Promise(r => setTimeout(r, 5));
    const second = store.upsert(mkRoutine('a', { name: 'renamed' }));
    expect(second.createdAt).toBe(first.createdAt);
    expect(second.updatedAt).not.toBe(first.updatedAt);
  });

  it('removes a routine when present', () => {
    const store = new RoutineStore(path);
    store.upsert(mkRoutine('a'));
    expect(store.remove('a')).toBeTruthy();
    expect(store.list()).toHaveLength(0);
  });

  it('returns false when removing a missing id', () => {
    const store = new RoutineStore(path);
    expect(store.remove('missing')).toBeFalsy();
  });

  it('seeds defaults exactly once', () => {
    const store = new RoutineStore(path);
    const first = store.seedDefaults([mkRoutine('a'), mkRoutine('b')]);
    expect(first).toEqual({ seeded: 2, skipped: 0 });
    const second = store.seedDefaults([mkRoutine('c')]);
    expect(second).toEqual({ seeded: 0, skipped: 1 });
    expect(store.list()).toHaveLength(2);
  });

  it('seedDefaults does not overwrite an existing matching id', () => {
    const store = new RoutineStore(path);
    store.upsert(mkRoutine('a', { name: 'user-edited' }));
    store.seedDefaults([mkRoutine('a', { name: 'default' }), mkRoutine('b')]);
    expect(store.get('a')?.name).toBe('user-edited');
    expect(store.get('b')).not.toBeNull();
  });
});
