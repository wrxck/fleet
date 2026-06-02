import { spawn } from 'node:child_process';

import type { RoutineTask, RunEvent } from '../../core/routines/schema';
import { shquote, sshConnectFlags } from '../../core/runners/ssh';
import type { RemoteHost } from '../../core/runners/types';
import type { RunContext, RunnerAdapter } from '../types';

// re-exported so existing importers (and tests) can keep `from './remote'`.
export type { RemoteHost };

export interface RemoteRunnerOptions {
  // resolve a host id (task.host) to its connection, or null when unknown.
  resolveHost: (id: string) => RemoteHost | null;
  // overridable for tests; defaults to the system ssh client.
  sshBinary?: string;
}

type RemoteTask = Extract<RoutineTask, { kind: 'remote' }>;

// build the local ssh invocation for a remote task. exported and pure because
// it does the security-sensitive command rendering — unit-tested directly.
export function buildSshInvocation(
  host: RemoteHost,
  task: RemoteTask,
  sshBinary = 'ssh',
): { cmd: string; args: string[] } {
  const cwd = task.cwd ?? host.defaultCwd;
  // each argv token is shell-quoted, so a validated token reaches the remote
  // intact even when it contains a space or a single quote.
  const rendered = task.argv.map(shquote).join(' ');
  const withCwd = cwd ? `cd ${shquote(cwd)} && ${rendered}` : rendered;
  // a login shell (`zsh -lc`) is what puts brew-managed tools (node, pod) on
  // PATH on a macos host; a bare ssh command runs a non-login shell without it.
  const remote = task.loginShell ? `zsh -lc ${shquote(withCwd)}` : withCwd;

  return { cmd: sshBinary, args: [...sshConnectFlags(host), host.destination, remote] };
}

export function createRemoteRunner(opts: RemoteRunnerOptions): RunnerAdapter {
  const sshBinary = opts.sshBinary ?? 'ssh';

  return {
    id: 'remote',

    supports(task: RoutineTask): boolean {
      return task.kind === 'remote';
    },

    async *run(
      task: RoutineTask,
      ctx: RunContext,
      signal: AbortSignal,
    ): AsyncIterable<RunEvent> {
      if (task.kind !== 'remote') throw new Error('remote runner received non-remote task');

      const startedAt = new Date().toISOString();
      const startTime = Date.now();

      yield {
        kind: 'start',
        routineId: ctx.routineId,
        target: ctx.repo ?? task.host,
        at: startedAt,
      };

      const host = opts.resolveHost(task.host);
      if (!host) {
        // fail closed: an unregistered host never reaches ssh.
        yield {
          kind: 'end',
          status: 'failed',
          exitCode: -1,
          durationMs: Date.now() - startTime,
          at: new Date().toISOString(),
          error: `unknown remote host: ${task.host}`,
        };
        return;
      }

      const { cmd, args } = buildSshInvocation(host, task, sshBinary);
      const child = spawn(cmd, args, {
        env: { ...process.env, ...ctx.env },
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
          push({ kind: 'stderr', chunk: `ssh spawn error: ${err.message}\n` });
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
      const status: 'ok' | 'failed' | 'timeout' | 'aborted' =
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
