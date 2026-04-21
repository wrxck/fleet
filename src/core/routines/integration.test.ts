import { rmSync } from 'node:fs';
import { join } from 'node:path';

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { createShellRunner } from '../../adapters/runner/shell.js';
import { closeDb, openDb } from './db.js';
import { RoutineEngine } from './engine.js';
import type { Routine } from './schema.js';
import { RoutineStore } from './store.js';
import { mkExecTmpDir } from './test-utils.js';

const mkRoutine = (overrides: Partial<Routine> = {}): Routine => ({
  id: 'int-echo',
  name: 'integration echo',
  description: '',
  schedule: { kind: 'manual' },
  enabled: true,
  targets: [],
  perTarget: false,
  task: { kind: 'shell', argv: ['printf', 'integration-ok'], wallClockMs: 5000 },
  notify: [],
  tags: [],
  ...overrides,
});

describe('integration: shell runner through engine', () => {
  let dir: string;
  let db: ReturnType<typeof openDb>;

  beforeEach(() => {
    dir = mkExecTmpDir('fleet-int-');
    db = openDb({ path: join(dir, 'fleet.db') });
  });

  afterEach(() => {
    closeDb();
    rmSync(dir, { recursive: true, force: true });
  });

  it('persists a full run lifecycle to sqlite: row + events + 0 cost', async () => {
    const store = new RoutineStore(join(dir, 'routines.json'));
    const engine = new RoutineEngine({ store, db, runners: [createShellRunner()] });
    store.upsert(mkRoutine());

    const events = [];
    for await (const ev of engine.runOnce('int-echo')) events.push(ev);

    const runs = engine.recentRuns('int-echo');
    expect(runs).toHaveLength(1);
    expect(runs[0].status).toBe('ok');
    expect(runs[0].exitCode).toBe(0);

    const eventRows = db.prepare('SELECT COUNT(*) AS c FROM routine_run_events WHERE run_id = ?').get(runs[0].runId) as { c: number };
    expect(eventRows.c).toBe(events.length);

    const costRow = db.prepare('SELECT COUNT(*) AS c FROM routine_cost WHERE run_id = ?').get(runs[0].runId) as { c: number };
    expect(costRow.c).toBe(0);
  });

  it('handles a failing command and still writes a finished row', async () => {
    const store = new RoutineStore(join(dir, 'routines.json'));
    const engine = new RoutineEngine({ store, db, runners: [createShellRunner()] });
    store.upsert(mkRoutine({
      id: 'int-fail',
      task: { kind: 'shell', argv: ['false'], wallClockMs: 5000 },
    }));

    for await (const _ of engine.runOnce('int-fail')) { /* drain */ }

    const runs = engine.recentRuns('int-fail');
    expect(runs).toHaveLength(1);
    expect(runs[0].status).toBe('failed');
    expect(runs[0].endedAt).not.toBeNull();
  });
});
