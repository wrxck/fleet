import { rmSync } from 'node:fs';
import { join } from 'node:path';

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { createShellRunner } from '../../adapters/runner/shell.js';
import { closeDb, openDb } from './db.js';
import { RoutineEngine } from './engine.js';
import type { Routine, RunEvent } from './schema.js';
import { RoutineStore } from './store.js';
import { mkExecTmpDir } from './test-utils.js';

const mkRoutine = (overrides: Partial<Routine> = {}): Routine => ({
  id: 'r-echo',
  name: 'echo test',
  description: '',
  schedule: { kind: 'manual' },
  enabled: true,
  targets: [],
  perTarget: false,
  task: { kind: 'shell', argv: ['printf', 'hello'], wallClockMs: 5000 },
  notify: [],
  tags: [],
  ...overrides,
});

describe('RoutineEngine', () => {
  let dir: string;
  let db: ReturnType<typeof openDb>;
  let store: RoutineStore;
  let engine: RoutineEngine;

  beforeEach(() => {
    dir = mkExecTmpDir('fleet-engine-');
    db = openDb({ path: join(dir, 'fleet.db') });
    store = new RoutineStore(join(dir, 'routines.json'));
    engine = new RoutineEngine({ store, db, runners: [createShellRunner()] });
  });

  afterEach(() => {
    closeDb();
    rmSync(dir, { recursive: true, force: true });
  });

  it('executes a routine end-to-end and persists the run', async () => {
    store.upsert(mkRoutine());
    const events: RunEvent[] = [];
    for await (const ev of engine.runOnce('r-echo')) events.push(ev);

    expect(events[0].kind).toBe('start');
    expect(events[events.length - 1].kind).toBe('end');

    const recent = engine.recentRuns('r-echo');
    expect(recent).toHaveLength(1);
    expect(recent[0].status).toBe('ok');
    expect(recent[0].exitCode).toBe(0);
    expect(recent[0].durationMs).toBeGreaterThanOrEqual(0);
  });

  it('persists every event to routine_run_events', async () => {
    store.upsert(mkRoutine());
    for await (const _ of engine.runOnce('r-echo')) { /* drain */ }
    const row = db.prepare('SELECT COUNT(*) AS c FROM routine_run_events').get() as { c: number };
    expect(row.c).toBeGreaterThanOrEqual(2);
  });

  it('throws when routine is missing', async () => {
    await expect(async () => {
      for await (const _ of engine.runOnce('missing')) { /* noop */ }
    }).rejects.toThrow(/not found/);
  });

  it('throws when no runner registered for task kind', async () => {
    store.upsert(mkRoutine({
      id: 'r-mcp',
      task: { kind: 'mcp-call', tool: 'x', args: {}, wallClockMs: 1000 },
    }));
    await expect(async () => {
      for await (const _ of engine.runOnce('r-mcp')) { /* noop */ }
    }).rejects.toThrow(/no runner/);
  });

  it('records failed status for non-zero exits', async () => {
    store.upsert(mkRoutine({
      id: 'r-fail',
      task: { kind: 'shell', argv: ['false'], wallClockMs: 5000 },
    }));
    for await (const _ of engine.runOnce('r-fail')) { /* drain */ }
    const recent = engine.recentRuns('r-fail');
    expect(recent[0].status).toBe('failed');
  });

  it('costSinceDays returns 0 when no runs have cost events', async () => {
    store.upsert(mkRoutine());
    for await (const _ of engine.runOnce('r-echo')) { /* drain */ }
    const cost = engine.costSinceDays('r-echo');
    expect(cost.usd).toBe(0);
  });
});
