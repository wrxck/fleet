import { describe, it, expect } from 'vitest';

import type { RoutineTask, RunEvent } from '../../core/routines/schema.js';
import type { RunContext } from '../types.js';
import { createShellRunner } from './shell.js';

const ctx: RunContext = {
  repo: null,
  repoPath: null,
  runId: 'run-1',
  routineId: 'r-test',
  startedAt: new Date().toISOString(),
  logsDir: '/tmp',
  env: {},
};

async function collect(task: RoutineTask, signal: AbortSignal): Promise<RunEvent[]> {
  const runner = createShellRunner();
  const events: RunEvent[] = [];
  for await (const ev of runner.run(task, ctx, signal)) events.push(ev);
  return events;
}

describe('shell runner', () => {
  it('emits start, stdout, end for a successful command', async () => {
    const events = await collect(
      { kind: 'shell', argv: ['printf', 'hello world'], wallClockMs: 5000 },
      new AbortController().signal,
    );
    expect(events[0]?.kind).toBe('start');
    const stdoutEvents = events.filter(e => e.kind === 'stdout');
    expect(stdoutEvents.map(e => (e.kind === 'stdout' ? e.chunk : '')).join('')).toContain('hello world');
    const end = events[events.length - 1];
    expect(end?.kind).toBe('end');
    if (end?.kind === 'end') {
      expect(end.status).toBe('ok');
      expect(end.exitCode).toBe(0);
    }
  });

  it('reports failed status for non-zero exit', async () => {
    const events = await collect(
      { kind: 'shell', argv: ['false'], wallClockMs: 5000 },
      new AbortController().signal,
    );
    const end = events[events.length - 1];
    expect(end?.kind).toBe('end');
    if (end?.kind === 'end') expect(end.status).toBe('failed');
  });

  it('reports timeout when wall-clock exceeded', async () => {
    const events = await collect(
      { kind: 'shell', argv: ['sleep', '5'], wallClockMs: 200 },
      new AbortController().signal,
    );
    const end = events[events.length - 1];
    expect(end?.kind).toBe('end');
    if (end?.kind === 'end') expect(end.status).toBe('timeout');
  }, 10_000);

  it('reports aborted when signal fires', async () => {
    const ac = new AbortController();
    setTimeout(() => ac.abort(), 150);
    const events = await collect(
      { kind: 'shell', argv: ['sleep', '5'], wallClockMs: 10_000 },
      ac.signal,
    );
    const end = events[events.length - 1];
    expect(end?.kind).toBe('end');
    if (end?.kind === 'end') expect(end.status).toBe('aborted');
  }, 10_000);
});
