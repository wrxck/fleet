import { spawn } from 'node:child_process';

import type { RoutineTask, RunEvent } from '../../core/routines/schema.js';
import type { RunContext, RunnerAdapter } from '../types.js';

export function createShellRunner(): RunnerAdapter {
  return {
    id: 'shell',

    supports(task: RoutineTask): boolean {
      return task.kind === 'shell';
    },

    async *run(
      task: RoutineTask,
      ctx: RunContext,
      signal: AbortSignal,
    ): AsyncIterable<RunEvent> {
      if (task.kind !== 'shell') throw new Error('shell runner received non-shell task');

      const startedAt = new Date().toISOString();
      const startTime = Date.now();

      yield {
        kind: 'start',
        routineId: ctx.routineId,
        target: ctx.repo ?? null,
        at: startedAt,
      };

      const [cmd, ...args] = task.argv;
      const env = { ...process.env, ...ctx.env, ...(task.env ?? {}) };

      const child = spawn(cmd, args, {
        cwd: ctx.repoPath ?? undefined,
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      const buffer: RunEvent[] = [];
      let resolve: (() => void) | null = null;
      const waitForEvent = () => new Promise<void>(r => { resolve = r; });
      const push = (ev: RunEvent) => {
        buffer.push(ev);
        if (resolve) { resolve(); resolve = null; }
      };

      const timer = setTimeout(() => {
        child.kill('SIGTERM');
        setTimeout(() => child.kill('SIGKILL'), 5000);
      }, task.wallClockMs);

      const onAbort = () => {
        child.kill('SIGTERM');
        setTimeout(() => child.kill('SIGKILL'), 5000);
      };
      signal.addEventListener('abort', onAbort);

      child.stdout?.setEncoding('utf-8');
      child.stderr?.setEncoding('utf-8');
      child.stdout?.on('data', chunk => push({ kind: 'stdout', chunk }));
      child.stderr?.on('data', chunk => push({ kind: 'stderr', chunk }));

      let exitCode = -1;
      let exitSignal: NodeJS.Signals | null = null;
      let done = false;
      const exited = new Promise<void>(resolveExit => {
        child.on('close', (code, sig) => {
          exitCode = code ?? -1;
          exitSignal = sig;
          done = true;
          if (resolve) { resolve(); resolve = null; }
          resolveExit();
        });
        child.on('error', err => {
          push({ kind: 'stderr', chunk: `spawn error: ${err.message}\n` });
          done = true;
          if (resolve) { resolve(); resolve = null; }
          resolveExit();
        });
      });

      try {
        while (!done || buffer.length > 0) {
          if (buffer.length === 0 && !done) await waitForEvent();
          while (buffer.length > 0) {
            const ev = buffer.shift();
            if (ev) yield ev;
          }
        }
        await exited;
      } finally {
        clearTimeout(timer);
        signal.removeEventListener('abort', onAbort);
      }

      const durationMs = Date.now() - startTime;
      const status: RunEvent['kind'] extends 'end' ? never : 'ok' | 'failed' | 'timeout' | 'aborted' =
        signal.aborted ? 'aborted'
          : exitSignal === 'SIGTERM' || exitSignal === 'SIGKILL' ? 'timeout'
            : exitCode === 0 ? 'ok' : 'failed';

      yield {
        kind: 'end',
        status,
        exitCode,
        durationMs,
        at: new Date().toISOString(),
        ...(exitSignal ? { error: `signal=${exitSignal}` } : {}),
      };
    },
  };
}
