import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { RoutineTask, RunEvent } from '../../core/routines/schema';
import type { RunContext } from '../types';
import { buildSshInvocation, createRemoteRunner, type RemoteHost } from './remote';

const ctx: RunContext = {
  repo: null,
  repoPath: null,
  runId: 'run-1',
  routineId: 'r-test',
  startedAt: new Date().toISOString(),
  logsDir: '/tmp',
  env: {},
};

type RemoteTask = Extract<RoutineTask, { kind: 'remote' }>;

function remoteTask(partial: Partial<RemoteTask>): RemoteTask {
  return {
    kind: 'remote',
    host: 'h',
    argv: ['printf', 'hi'],
    loginShell: false,
    wallClockMs: 5000,
    ...partial,
  };
}

describe('buildSshInvocation', () => {
  const host: RemoteHost = { destination: 'matt@box', port: 2222, identityFile: '/k/id' };

  it('passes connection flags, port and identity', () => {
    const { cmd, args } = buildSshInvocation(host, remoteTask({}));
    expect(cmd).toBe('ssh');
    expect(args).toContain('BatchMode=yes');
    expect(args).toEqual(expect.arrayContaining(['-p', '2222', '-i', '/k/id', 'matt@box']));
  });

  it('places a -- separator immediately before the destination', () => {
    const { args } = buildSshInvocation(host, remoteTask({}));
    const sep = args.indexOf('--');
    expect(sep).toBeGreaterThanOrEqual(0);
    // the destination must be the token right after --, so ssh can never read
    // it as an option (e.g. -oProxyCommand=...).
    expect(args[sep + 1]).toBe('matt@box');
  });

  it('wraps in a login shell when requested so brew PATH resolves', () => {
    const { args } = buildSshInvocation(host, remoteTask({ loginShell: true, argv: ['node', '-v'] }));
    const remote = args[args.length - 1];
    // the inner command is itself single-quoted for `zsh -lc`, so the argv
    // tokens are nested-escaped rather than appearing verbatim.
    expect(remote.startsWith("zsh -lc '")).toBe(true);
    expect(remote).toContain('node');
    expect(remote).toContain('-v');
  });

  it('prefixes a cd when a cwd is given', () => {
    const { args } = buildSshInvocation(host, remoteTask({ cwd: '/srv/app', argv: ['npm', 'run', 'build'] }));
    expect(args[args.length - 1]).toBe("cd '/srv/app' && 'npm' 'run' 'build'");
  });

  it('shell-quotes tokens containing spaces and single quotes', () => {
    const { args } = buildSshInvocation(host, remoteTask({ argv: ['echo', "it's a test"] }));
    // a single quote becomes '\'' inside the quoted token — no breakout.
    expect(args[args.length - 1]).toBe("'echo' 'it'\\''s a test'");
  });

  it('falls back to the host defaultCwd when the task omits one', () => {
    const { args } = buildSshInvocation({ destination: 'd', defaultCwd: '/home/me' }, remoteTask({ argv: ['pwd'] }));
    expect(args[args.length - 1]).toBe("cd '/home/me' && 'pwd'");
  });
});

describe('remote runner', () => {
  // a fake ssh that ignores connection flags and runs the final argument (the
  // rendered remote command) locally, so the streaming/status path is exercised
  // without a real ssh server or zsh on the ci host.
  let fakeSsh: string;
  let fakeDir: string;
  const resolveHost = () => ({ destination: 'ignored' });

  beforeAll(() => {
    // the os tmpdir is mounted noexec on some hosts, so the shim could not be
    // executed there — place it under the home dir, which is exec-capable.
    fakeDir = mkdtempSync(join(homedir(), '.fleet-remote-test-'));
    fakeSsh = join(fakeDir, 'fake-ssh');
    writeFileSync(fakeSsh, '#!/bin/sh\nfor a in "$@"; do last="$a"; done\nexec sh -c "$last"\n');
    chmodSync(fakeSsh, 0o755);
  });

  afterAll(() => {
    rmSync(fakeDir, { recursive: true, force: true });
  });

  async function collect(task: RoutineTask, signal: AbortSignal): Promise<RunEvent[]> {
    const runner = createRemoteRunner({ resolveHost, sshBinary: fakeSsh });
    const events: RunEvent[] = [];
    for await (const ev of runner.run(task, ctx, signal)) events.push(ev);
    return events;
  }

  it('emits start, stdout and an ok end for a successful command', async () => {
    const events = await collect(remoteTask({ argv: ['printf', 'hello world'] }), new AbortController().signal);
    expect(events[0]?.kind).toBe('start');
    const stdout = events.filter(e => e.kind === 'stdout').map(e => (e.kind === 'stdout' ? e.chunk : '')).join('');
    expect(stdout).toContain('hello world');
    const end = events[events.length - 1];
    if (end?.kind === 'end') {
      expect(end.status).toBe('ok');
      expect(end.exitCode).toBe(0);
    } else expect.unreachable('last event should be end');
  });

  it('reports failed status for a non-zero exit', async () => {
    const events = await collect(remoteTask({ argv: ['false'] }), new AbortController().signal);
    const end = events[events.length - 1];
    if (end?.kind === 'end') expect(end.status).toBe('failed');
    else expect.unreachable('last event should be end');
  });

  it('fails closed when the host is unknown', async () => {
    const runner = createRemoteRunner({ resolveHost: () => null, sshBinary: fakeSsh });
    const events: RunEvent[] = [];
    for await (const ev of runner.run(remoteTask({ host: 'nope' }), ctx, new AbortController().signal)) {
      events.push(ev);
    }
    const end = events[events.length - 1];
    if (end?.kind === 'end') {
      expect(end.status).toBe('failed');
      expect(end.error).toContain('unknown remote host');
    } else expect.unreachable('last event should be end');
  });

  it('reports timeout when wall-clock is exceeded', async () => {
    const events = await collect(remoteTask({ argv: ['sleep', '5'], wallClockMs: 200 }), new AbortController().signal);
    const end = events[events.length - 1];
    if (end?.kind === 'end') expect(end.status).toBe('timeout');
    else expect.unreachable('last event should be end');
  }, 10_000);

  it('reports aborted when the signal fires', async () => {
    const ac = new AbortController();
    setTimeout(() => ac.abort(), 150);
    const events = await collect(remoteTask({ argv: ['sleep', '5'], wallClockMs: 10_000 }), ac.signal);
    const end = events[events.length - 1];
    if (end?.kind === 'end') expect(end.status).toBe('aborted');
    else expect.unreachable('last event should be end');
  }, 10_000);
});
