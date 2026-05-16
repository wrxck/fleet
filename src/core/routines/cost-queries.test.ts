import { rmSync } from 'node:fs';
import { join } from 'node:path';

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { closeDb, openDb } from '@/core/routines/db.js';
import { costByRoutine, costRollup, dailyCostSeries } from '@/core/routines/cost-queries.js';
import { mkExecTmpDir } from '@/core/routines/test-utils.js';

function insertRun(
  db: ReturnType<typeof openDb>,
  runId: string,
  routineId: string,
  startedAt: string,
  usd: number,
  inputTokens = 0,
  outputTokens = 0,
): void {
  db.prepare(`
    INSERT INTO routine_runs (run_id, routine_id, started_at, status, runner_kind, scheduler_kind, triggered_by)
    VALUES (?, ?, ?, 'ok', 'shell', 'none', 'manual')
  `).run(runId, routineId, startedAt);
  db.prepare(`
    INSERT INTO routine_cost (run_id, input_tokens, output_tokens, usd)
    VALUES (?, ?, ?, ?)
  `).run(runId, inputTokens, outputTokens, usd);
}

describe('cost queries', () => {
  let dir: string;
  let db: ReturnType<typeof openDb>;

  beforeEach(() => {
    dir = mkExecTmpDir('fleet-cost-');
    db = openDb({ path: join(dir, 'fleet.db') });
  });

  afterEach(() => {
    closeDb();
    rmSync(dir, { recursive: true, force: true });
  });

  it('costRollup returns 0 for everything on an empty db', () => {
    const r = costRollup(db);
    expect(r).toEqual({
      usdToday: 0, usdWeek: 0, usdMonth: 0, runsToday: 0, runsWeek: 0, runsMonth: 0,
    });
  });

  it('costRollup sums across day/week/month windows', () => {
    const now = Date.now();
    insertRun(db, 'a', 'r1', new Date(now - 10 * 60_000).toISOString(), 0.5);
    insertRun(db, 'b', 'r2', new Date(now - 3 * 86_400_000).toISOString(), 1.25);
    insertRun(db, 'c', 'r2', new Date(now - 20 * 86_400_000).toISOString(), 2.0);
    const r = costRollup(db);
    expect(r.usdToday).toBeCloseTo(0.5, 2);
    expect(r.usdWeek).toBeCloseTo(1.75, 2);
    expect(r.usdMonth).toBeCloseTo(3.75, 2);
    expect(r.runsMonth).toBe(3);
  });

  it('costByRoutine groups and sorts by spend desc', () => {
    const now = Date.now();
    insertRun(db, 'a', 'audit', new Date(now - 60_000).toISOString(), 1.5, 1000, 500);
    insertRun(db, 'b', 'audit', new Date(now - 120_000).toISOString(), 2.0, 2000, 1000);
    insertRun(db, 'c', 'deps', new Date(now - 60_000).toISOString(), 0.25);
    const rows = costByRoutine(db);
    expect(rows[0].routineId).toBe('audit');
    expect(rows[0].usd).toBeCloseTo(3.5, 2);
    expect(rows[0].runs).toBe(2);
    expect(rows[0].inputTokens).toBe(3000);
    expect(rows[1].routineId).toBe('deps');
  });

  it('dailyCostSeries produces one bucket per day', () => {
    const series = dailyCostSeries(db, 7);
    expect(series).toHaveLength(7);
    expect(series[series.length - 1].date).toBe(new Date().toISOString().slice(0, 10));
    expect(series[0].usd).toBe(0);
  });
});
