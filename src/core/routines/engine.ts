import { randomUUID } from 'node:crypto';

import type Database from 'better-sqlite3';

import type { NotifierAdapter, RunnerAdapter, SchedulerAdapter, RunContext } from '../../adapters/types.js';
import type { Routine, RunEvent, RunStatus } from './schema.js';
import { RoutineStore } from './store.js';

export type RunTrigger = 'manual' | 'scheduled' | 'api';

export interface RunPersistencePayload {
  runId: string;
  routineId: string;
  target: string | null;
  startedAt: string;
  endedAt?: string;
  status: RunStatus;
  exitCode?: number;
  durationMs?: number;
  error?: string;
  runnerKind: Routine['task']['kind'];
  schedulerKind: SchedulerAdapter['id'] | 'none';
  triggeredBy: RunTrigger;
}

export interface RecentRun {
  runId: string;
  routineId: string;
  target: string | null;
  startedAt: string;
  endedAt: string | null;
  status: RunStatus;
  exitCode: number | null;
  durationMs: number | null;
  error: string | null;
  usd: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
}

export interface EngineOptions {
  store: RoutineStore;
  db: Database.Database;
  runners: RunnerAdapter[];
  scheduler?: SchedulerAdapter | null;
  notifiers?: NotifierAdapter[];
  logsDir?: string;
}

function initRunRow(db: Database.Database, p: RunPersistencePayload): void {
  db.prepare(`
    INSERT INTO routine_runs (run_id, routine_id, target, started_at, status, runner_kind, scheduler_kind, triggered_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(p.runId, p.routineId, p.target, p.startedAt, p.status, p.runnerKind, p.schedulerKind, p.triggeredBy);
}

function finishRunRow(
  db: Database.Database,
  runId: string,
  update: { endedAt: string; status: RunStatus; exitCode: number; durationMs: number; error?: string },
): void {
  db.prepare(`
    UPDATE routine_runs
    SET ended_at = ?, status = ?, exit_code = ?, duration_ms = ?, error = ?
    WHERE run_id = ?
  `).run(update.endedAt, update.status, update.exitCode, update.durationMs, update.error ?? null, runId);
}

function appendEvent(db: Database.Database, runId: string, seq: number, event: RunEvent): void {
  const at = 'at' in event ? event.at : new Date().toISOString();
  db.prepare(`
    INSERT INTO routine_run_events (run_id, seq, at, kind, payload)
    VALUES (?, ?, ?, ?, ?)
  `).run(runId, seq, at, event.kind, JSON.stringify(event));
}

function upsertCost(db: Database.Database, runId: string, c: Extract<RunEvent, { kind: 'cost' }>): void {
  db.prepare(`
    INSERT INTO routine_cost (run_id, input_tokens, output_tokens, cache_create_tokens, cache_read_tokens, usd)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(run_id) DO UPDATE SET
      input_tokens = excluded.input_tokens,
      output_tokens = excluded.output_tokens,
      cache_create_tokens = excluded.cache_create_tokens,
      cache_read_tokens = excluded.cache_read_tokens,
      usd = excluded.usd
  `).run(runId, c.inputTokens, c.outputTokens, c.cacheCreateTokens, c.cacheReadTokens, c.usd);
}

export class RoutineEngine {
  private readonly runners: Map<Routine['task']['kind'], RunnerAdapter>;

  constructor(private readonly opts: EngineOptions) {
    this.runners = new Map(opts.runners.map(r => [r.id, r]));
  }

  get store(): RoutineStore {
    return this.opts.store;
  }

  get db(): Database.Database {
    return this.opts.db;
  }

  async *runOnce(
    routineId: string,
    target: { repo: string | null; repoPath: string | null } = { repo: null, repoPath: null },
    trigger: RunTrigger = 'manual',
    signal: AbortSignal = new AbortController().signal,
  ): AsyncIterable<RunEvent> {
    const routine = this.opts.store.get(routineId);
    if (!routine) throw new Error(`routine not found: ${routineId}`);
    const runner = this.runners.get(routine.task.kind);
    if (!runner) throw new Error(`no runner registered for task kind: ${routine.task.kind}`);

    const runId = randomUUID();
    const startedAt = new Date().toISOString();
    initRunRow(this.opts.db, {
      runId,
      routineId,
      target: target.repo,
      startedAt,
      status: 'running',
      runnerKind: routine.task.kind,
      schedulerKind: this.opts.scheduler?.id ?? 'none',
      triggeredBy: trigger,
    });

    const ctx: RunContext = {
      repo: target.repo,
      repoPath: target.repoPath,
      runId,
      routineId,
      startedAt,
      logsDir: this.opts.logsDir ?? '/var/log/fleet',
      env: { FLEET_ROUTINE_ID: routineId, FLEET_RUN_ID: runId },
    };

    let seq = 0;
    let lastExitCode = -1;
    let lastDurationMs = 0;
    let lastStatus: RunStatus = 'failed';
    let lastError: string | undefined;

    try {
      for await (const event of runner.run(routine.task, ctx, signal)) {
        appendEvent(this.opts.db, runId, seq++, event);
        if (event.kind === 'cost') upsertCost(this.opts.db, runId, event);
        if (event.kind === 'end') {
          lastExitCode = event.exitCode;
          lastDurationMs = event.durationMs;
          lastStatus = event.status;
          lastError = event.error;
        }
        yield event;
      }
    } catch (err) {
      lastError = (err as Error).message;
      appendEvent(this.opts.db, runId, seq++, {
        kind: 'end',
        status: 'failed',
        exitCode: -1,
        durationMs: 0,
        at: new Date().toISOString(),
        error: lastError,
      });
      lastStatus = 'failed';
    } finally {
      finishRunRow(this.opts.db, runId, {
        endedAt: new Date().toISOString(),
        status: lastStatus,
        exitCode: lastExitCode,
        durationMs: lastDurationMs,
        error: lastError,
      });
      if (this.opts.notifiers?.length) {
        const shouldNotify = routine.notify.some(n =>
          n.on === 'always' || (n.on === 'failure' && lastStatus !== 'ok') || (n.on === 'success' && lastStatus === 'ok'),
        );
        if (shouldNotify) {
          const subject = `fleet: ${routine.id} ${lastStatus}`;
          const body = `run ${runId} for ${routine.id} ended ${lastStatus} (exit=${lastExitCode}, ${lastDurationMs}ms)`;
          await Promise.allSettled(
            this.opts.notifiers.map(n => n.notify(subject, body, { routineId, runId, status: lastStatus })),
          );
        }
      }
    }
  }

  recentRuns(routineId: string, limit = 20): RecentRun[] {
    const rows = this.opts.db.prepare(`
      SELECT r.run_id, r.routine_id, r.target, r.started_at, r.ended_at, r.status, r.exit_code, r.duration_ms, r.error,
             c.usd, c.input_tokens, c.output_tokens
      FROM routine_runs r
      LEFT JOIN routine_cost c ON c.run_id = r.run_id
      WHERE r.routine_id = ?
      ORDER BY r.started_at DESC
      LIMIT ?
    `).all(routineId, limit) as {
      run_id: string;
      routine_id: string;
      target: string | null;
      started_at: string;
      ended_at: string | null;
      status: string;
      exit_code: number | null;
      duration_ms: number | null;
      error: string | null;
      usd: number | null;
      input_tokens: number | null;
      output_tokens: number | null;
    }[];
    return rows.map(row => ({
      runId: row.run_id,
      routineId: row.routine_id,
      target: row.target,
      startedAt: row.started_at,
      endedAt: row.ended_at,
      status: row.status as RunStatus,
      exitCode: row.exit_code,
      durationMs: row.duration_ms,
      error: row.error,
      usd: row.usd,
      inputTokens: row.input_tokens,
      outputTokens: row.output_tokens,
    }));
  }

  costSinceDays(routineId: string, days = 30): { usd: number; runs: number } {
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
    const row = this.opts.db.prepare(`
      SELECT COALESCE(SUM(c.usd), 0) AS usd, COUNT(DISTINCT c.run_id) AS runs
      FROM routine_cost c
      JOIN routine_runs r ON r.run_id = c.run_id
      WHERE r.routine_id = ? AND r.started_at >= ?
    `).get(routineId, since) as { usd: number; runs: number };
    return { usd: row.usd, runs: row.runs };
  }

  async register(routine: Routine): Promise<Routine> {
    const stored = this.opts.store.upsert(routine);
    if (this.opts.scheduler && stored.schedule.kind !== 'manual') {
      await this.opts.scheduler.upsert(stored);
    }
    return stored;
  }

  async unregister(routineId: string): Promise<boolean> {
    if (this.opts.scheduler) {
      try { await this.opts.scheduler.remove(routineId); } catch { /* ignore */ }
    }
    return this.opts.store.remove(routineId);
  }
}
