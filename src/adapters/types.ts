import type { Routine, RoutineTask, RunEvent, Signal, SignalKind } from '../core/routines/schema.js';

export interface ScheduledEntry {
  routineId: string;
  unitName: string;
  nextRunAt: string | null;
  lastRunAt: string | null;
  lastStatus: 'ok' | 'failed' | 'unknown';
  active: boolean;
  persistent: boolean;
}

export interface SchedulerAdapter {
  readonly id: 'systemd-timer';
  readonly available: () => boolean;
  upsert(routine: Routine): Promise<void>;
  remove(routineId: string): Promise<void>;
  list(): Promise<ScheduledEntry[]>;
  get(routineId: string): Promise<ScheduledEntry | null>;
}

export interface RunContext {
  repo: string | null;
  repoPath: string | null;
  runId: string;
  routineId: string;
  startedAt: string;
  logsDir: string;
  env: Record<string, string>;
}

export interface RunnerAdapter {
  readonly id: RoutineTask['kind'];
  supports(task: RoutineTask): boolean;
  run(task: RoutineTask, ctx: RunContext, signal: AbortSignal): AsyncIterable<RunEvent>;
}

export interface SignalProvider {
  readonly kind: SignalKind;
  readonly ttlMs: number;
  readonly strategy: 'push' | 'pull' | 'event';
  collect(repoPath: string, repoName: string): Promise<Signal>;
  watch?(repoPath: string, repoName: string, emit: (s: Signal) => void): () => void;
}

export interface NotifierAdapter {
  readonly id: 'stdout' | 'webhook' | 'slack' | 'email';
  notify(subject: string, body: string, meta: { routineId: string; runId: string; status: string }): Promise<void>;
}

export interface StackDetector {
  readonly id: 'node' | 'python' | 'rust' | 'docker' | 'generic';
  detect(repoPath: string): boolean;
  priority: number;
}
