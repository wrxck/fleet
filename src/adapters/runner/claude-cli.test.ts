import { chmodSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import type { RoutineTask, RunEvent } from '../../core/routines/schema.js';
import { mkExecTmpDir, rmExecTmpDir } from '../../core/routines/test-utils.js';
import type { RunContext } from '../types.js';
import { createClaudeCliRunner } from './claude-cli.js';

const makeCtx = (dir: string): RunContext => ({
  repo: null,
  repoPath: null,
  runId: 'run-1',
  routineId: 'test-routine',
  startedAt: new Date().toISOString(),
  logsDir: dir,
  env: {},
});

async function collect(
  script: string,
  task: RoutineTask,
  dir: string,
  signal: AbortSignal,
): Promise<RunEvent[]> {
  const binary = join(dir, 'fake-claude.sh');
  writeFileSync(binary, script, { mode: 0o755 });
  chmodSync(binary, 0o755);
  const runner = createClaudeCliRunner({
    binary,
    lockRoot: join(dir, 'locks'),
    configRoot: join(dir, 'configs'),
  });
  const events: RunEvent[] = [];
  for await (const ev of runner.run(task, makeCtx(dir), signal)) events.push(ev);
  return events;
}

describe('claude-cli runner', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkExecTmpDir('fleet-claude-');
  });

  afterEach(() => {
    rmExecTmpDir(dir);
  });

  it('emits start, cost, end with ok status on clean exit', async () => {
    const stream = [
      JSON.stringify({ type: 'system', subtype: 'init' }),
      JSON.stringify({
        type: 'assistant',
        message: { content: [{ type: 'text', text: 'hello' }] },
      }),
      JSON.stringify({
        type: 'result',
        subtype: 'success',
        total_cost_usd: 0.01,
        usage: { input_tokens: 100, output_tokens: 50 },
      }),
    ].join('\n');
    const script = `#!/usr/bin/env bash\ncat <<'EOF'\n${stream}\nEOF\nexit 0\n`;

    const events = await collect(
      script,
      { kind: 'claude-cli', prompt: 'hi', outputFormat: 'json', tokenCap: 100_000, wallClockMs: 5000, maxUsd: 1 },
      dir,
      new AbortController().signal,
    );

    expect(events[0]?.kind).toBe('start');
    const cost = events.find(e => e.kind === 'cost');
    expect(cost).toBeDefined();
    if (cost?.kind === 'cost') {
      expect(cost.usd).toBe(0.01);
      expect(cost.inputTokens).toBe(100);
    }
    const end = events[events.length - 1];
    expect(end?.kind).toBe('end');
    if (end?.kind === 'end') expect(end.status).toBe('ok');
  });

  it('aborts when cost cap is exceeded', async () => {
    const stream = [
      JSON.stringify({
        type: 'result',
        total_cost_usd: 5.0,
        usage: { input_tokens: 10, output_tokens: 10 },
      }),
    ].join('\n');
    const script = `#!/usr/bin/env bash\ncat <<'EOF'\n${stream}\nEOF\nsleep 10\nexit 0\n`;

    const events = await collect(
      script,
      { kind: 'claude-cli', prompt: 'hi', outputFormat: 'json', tokenCap: 100_000, wallClockMs: 30_000, maxUsd: 1 },
      dir,
      new AbortController().signal,
    );

    const end = events[events.length - 1];
    expect(end?.kind).toBe('end');
    if (end?.kind === 'end') {
      expect(end.status).toBe('timeout');
      expect(end.error ?? '').toContain('cost cap');
    }
  }, 15_000);

  it('aborts when token cap is exceeded', async () => {
    const stream = [
      JSON.stringify({
        type: 'result',
        total_cost_usd: 0.001,
        usage: { input_tokens: 50_000, output_tokens: 60_000 },
      }),
    ].join('\n');
    const script = `#!/usr/bin/env bash\ncat <<'EOF'\n${stream}\nEOF\nsleep 10\nexit 0\n`;

    const events = await collect(
      script,
      { kind: 'claude-cli', prompt: 'hi', outputFormat: 'json', tokenCap: 50_000, wallClockMs: 30_000, maxUsd: 100 },
      dir,
      new AbortController().signal,
    );

    const end = events[events.length - 1];
    expect(end?.kind).toBe('end');
    if (end?.kind === 'end') {
      expect(end.status).toBe('timeout');
      expect(end.error ?? '').toContain('token cap');
    }
  }, 15_000);

  it('reports failed when non-zero exit with no cap breach', async () => {
    const script = `#!/usr/bin/env bash\necho '{"type":"system","subtype":"init"}'\nexit 2\n`;
    const events = await collect(
      script,
      { kind: 'claude-cli', prompt: 'hi', outputFormat: 'json', tokenCap: 100_000, wallClockMs: 5000, maxUsd: 1 },
      dir,
      new AbortController().signal,
    );
    const end = events[events.length - 1];
    expect(end?.kind).toBe('end');
    if (end?.kind === 'end') {
      expect(end.status).toBe('failed');
      expect(end.exitCode).toBe(2);
    }
  });

  it('serialises concurrent runs via lockfile', async () => {
    const script = `#!/usr/bin/env bash\nsleep 0.3\necho '{"type":"result","total_cost_usd":0.001,"usage":{"input_tokens":1,"output_tokens":1}}'\nexit 0\n`;
    const binary = join(dir, 'claude-slow.sh');
    writeFileSync(binary, script, { mode: 0o755 });
    chmodSync(binary, 0o755);

    const runner = createClaudeCliRunner({
      binary,
      lockRoot: join(dir, 'locks'),
      configRoot: join(dir, 'configs'),
    });
    const task: RoutineTask = {
      kind: 'claude-cli', prompt: 'x', outputFormat: 'json',
      tokenCap: 100_000, wallClockMs: 5000, maxUsd: 1,
    };
    const ac = new AbortController();

    const run = async (runId: string): Promise<RunEvent[]> => {
      const out: RunEvent[] = [];
      for await (const ev of runner.run(task, { ...makeCtx(dir), runId }, ac.signal)) out.push(ev);
      return out;
    };

    const [a, b] = await Promise.all([run('a'), run('b')]);
    const ends = [a, b].map(evs => evs[evs.length - 1]);
    const statuses = ends.map(e => (e?.kind === 'end' ? e.status : 'missing'));
    expect(statuses).toContain('ok');
    const errored = ends.find(e => e?.kind === 'end' && e.error?.includes('mutex busy'));
    expect(errored, 'one run should hit the mutex').toBeDefined();
  }, 15_000);
});
