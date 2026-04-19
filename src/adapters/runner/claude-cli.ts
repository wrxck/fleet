import { spawn } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

import lockfile from 'proper-lockfile';

import type { RoutineTask, RunEvent } from '../../core/routines/schema.js';
import type { RunContext, RunnerAdapter } from '../types.js';

export interface ClaudeCliOptions {
  binary?: string;
  lockRoot?: string;
  configRoot?: string;
}

interface ClaudeStreamEvent {
  type: string;
  subtype?: string;
  message?: { content?: Array<{ type: string; name?: string; input?: unknown }> };
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
  };
  total_cost_usd?: number;
  tools?: Array<{ name?: string; input?: unknown }>;
}

function summariseArgs(args: unknown): string {
  const s = JSON.stringify(args ?? null);
  return s.length > 200 ? `${s.slice(0, 197)}...` : s;
}

function ensureDir(path: string): void {
  if (!existsSync(path)) mkdirSync(path, { recursive: true });
}

export function createClaudeCliRunner(opts: ClaudeCliOptions = {}): RunnerAdapter {
  const binary = opts.binary ?? 'claude';
  const lockRoot = opts.lockRoot ?? '/var/lib/fleet/locks';
  const configRoot = opts.configRoot ?? '/var/lib/fleet/claude-configs';

  return {
    id: 'claude-cli',

    supports(task: RoutineTask): boolean {
      return task.kind === 'claude-cli';
    },

    async *run(
      task: RoutineTask,
      ctx: RunContext,
      signal: AbortSignal,
    ): AsyncIterable<RunEvent> {
      if (task.kind !== 'claude-cli') throw new Error('claude-cli runner received wrong task kind');

      ensureDir(lockRoot);
      ensureDir(configRoot);

      const lockTarget = join(lockRoot, 'claude-cli');
      ensureDir(lockTarget);

      const startedAt = new Date().toISOString();
      const startTime = Date.now();

      yield { kind: 'start', routineId: ctx.routineId, target: ctx.repo ?? null, at: startedAt };

      let release: (() => Promise<void>) | null = null;
      try {
        release = await lockfile.lock(lockTarget, { stale: 30 * 60 * 1000, retries: 0 });
      } catch (err) {
        yield {
          kind: 'end',
          status: 'failed',
          exitCode: -1,
          durationMs: Date.now() - startTime,
          at: new Date().toISOString(),
          error: `mutex busy: another claude-cli routine is running (${(err as Error).message})`,
        };
        return;
      }

      const perRoutineConfigDir = join(configRoot, ctx.routineId);
      ensureDir(perRoutineConfigDir);

      const args = [
        '-p', task.prompt,
        '--output-format', 'stream-json',
        '--verbose',
      ];
      if (task.model) args.push('--model', task.model);
      if (task.appendSystem) args.push('--append-system-prompt', task.appendSystem);
      if (task.allowedTools && task.allowedTools.length > 0) {
        args.push('--allowed-tools', task.allowedTools.join(','));
      }

      const env: Record<string, string> = {
        ...process.env,
        ...ctx.env,
        CLAUDE_CONFIG_DIR: perRoutineConfigDir,
      };

      const child = spawn(binary, args, {
        cwd: ctx.repoPath ?? undefined,
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      const buffer: RunEvent[] = [];
      let resolveWait: (() => void) | null = null;
      const waitForEvent = () => new Promise<void>(r => { resolveWait = r; });
      const push = (ev: RunEvent) => {
        buffer.push(ev);
        if (resolveWait) { resolveWait(); resolveWait = null; }
      };

      let cumulativeUsd = 0;
      let cumulativeInput = 0;
      let cumulativeOutput = 0;
      let cumulativeCacheCreate = 0;
      let cumulativeCacheRead = 0;
      let capBreached: string | null = null;

      const killChain = () => {
        child.kill('SIGTERM');
        setTimeout(() => { if (!child.killed) child.kill('SIGKILL'); }, 5000);
      };

      const timer = setTimeout(() => {
        capBreached = capBreached ?? 'wall-clock timeout';
        killChain();
      }, task.wallClockMs);

      const onAbort = () => { capBreached = capBreached ?? 'aborted by caller'; killChain(); };
      signal.addEventListener('abort', onAbort);

      let stdoutTail = '';
      child.stdout?.setEncoding('utf-8');
      child.stderr?.setEncoding('utf-8');

      child.stdout?.on('data', (chunk: string) => {
        stdoutTail += chunk;
        let newlineIdx: number;
        while ((newlineIdx = stdoutTail.indexOf('\n')) >= 0) {
          const line = stdoutTail.slice(0, newlineIdx);
          stdoutTail = stdoutTail.slice(newlineIdx + 1);
          if (!line.trim()) continue;
          let evt: ClaudeStreamEvent;
          try { evt = JSON.parse(line) as ClaudeStreamEvent; } catch {
            push({ kind: 'stdout', chunk: `${line}\n` });
            continue;
          }
          if (evt.type === 'assistant' && Array.isArray(evt.message?.content)) {
            for (const part of evt.message!.content!) {
              if (part.type === 'tool_use' && part.name) {
                push({ kind: 'tool-call', name: part.name, argsPreview: summariseArgs(part.input) });
              } else if (part.type === 'text' && typeof (part as { text?: unknown }).text === 'string') {
                push({ kind: 'stdout', chunk: (part as { text: string }).text });
              }
            }
          }
          if (evt.type === 'result') {
            const usage = evt.usage ?? {};
            cumulativeInput = Math.max(cumulativeInput, usage.input_tokens ?? 0);
            cumulativeOutput = Math.max(cumulativeOutput, usage.output_tokens ?? 0);
            cumulativeCacheCreate = Math.max(cumulativeCacheCreate, usage.cache_creation_input_tokens ?? 0);
            cumulativeCacheRead = Math.max(cumulativeCacheRead, usage.cache_read_input_tokens ?? 0);
            cumulativeUsd = Math.max(cumulativeUsd, evt.total_cost_usd ?? 0);
            push({
              kind: 'cost',
              inputTokens: cumulativeInput,
              outputTokens: cumulativeOutput,
              cacheCreateTokens: cumulativeCacheCreate,
              cacheReadTokens: cumulativeCacheRead,
              usd: cumulativeUsd,
            });
            const totalTokens = cumulativeInput + cumulativeOutput + cumulativeCacheCreate;
            if (totalTokens > task.tokenCap) {
              capBreached = capBreached ?? `token cap exceeded: ${totalTokens} > ${task.tokenCap}`;
              killChain();
            }
            if (cumulativeUsd > task.maxUsd) {
              capBreached = capBreached ?? `cost cap exceeded: $${cumulativeUsd.toFixed(4)} > $${task.maxUsd}`;
              killChain();
            }
          }
        }
      });

      child.stderr?.on('data', (chunk: string) => push({ kind: 'stderr', chunk }));

      let exitCode = -1;
      let exitSignal: NodeJS.Signals | null = null;
      let done = false;
      const exited = new Promise<void>(resolveExit => {
        child.on('close', (code, sig) => {
          if (stdoutTail.trim()) {
            try {
              const evt = JSON.parse(stdoutTail) as ClaudeStreamEvent;
              if (evt.type === 'result') {
                const usage = evt.usage ?? {};
                cumulativeInput = Math.max(cumulativeInput, usage.input_tokens ?? 0);
                cumulativeOutput = Math.max(cumulativeOutput, usage.output_tokens ?? 0);
                cumulativeUsd = Math.max(cumulativeUsd, evt.total_cost_usd ?? 0);
              }
            } catch { /* not JSON */ }
            stdoutTail = '';
          }
          exitCode = code ?? -1;
          exitSignal = sig;
          done = true;
          if (resolveWait) { resolveWait(); resolveWait = null; }
          resolveExit();
        });
        child.on('error', err => {
          push({ kind: 'stderr', chunk: `spawn error: ${err.message}\n` });
          done = true;
          if (resolveWait) { resolveWait(); resolveWait = null; }
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
        if (release) { try { await release(); } catch { /* already released */ } }
      }

      const durationMs = Date.now() - startTime;
      const status: 'ok' | 'failed' | 'timeout' | 'aborted' =
        capBreached === 'aborted by caller' ? 'aborted'
          : capBreached ? 'timeout'
            : exitSignal ? 'timeout'
              : exitCode === 0 ? 'ok' : 'failed';

      yield {
        kind: 'end',
        status,
        exitCode,
        durationMs,
        at: new Date().toISOString(),
        ...(capBreached ? { error: capBreached } : {}),
      };
    },
  };
}
