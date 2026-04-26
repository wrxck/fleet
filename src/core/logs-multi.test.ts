import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import {
  inferLevel,
  matchesContainerGlob,
  resolveSources,
  startMultiTail,
  type LogLine,
  type LogSource,
} from './logs-multi.js';
import type { AppEntry } from './registry.js';

function makeApp(overrides: Partial<AppEntry> = {}): AppEntry {
  return {
    name: 'macpool',
    displayName: 'macpool',
    composePath: '/x',
    composeFile: null,
    serviceName: 'macpool',
    domains: [],
    port: null,
    usesSharedDb: false,
    type: 'nextjs',
    containers: ['macpool'],
    dependsOnDatabases: false,
    registeredAt: '',
    ...overrides,
  };
}

describe('inferLevel', () => {
  it('detects error keywords', () => {
    expect(inferLevel('FATAL boom')).toBe('error');
    expect(inferLevel('Error: connection refused')).toBe('error');
    expect(inferLevel('uncaught Exception')).toBe('error');
  });
  it('detects warn keywords', () => {
    expect(inferLevel('WARNING something')).toBe('warn');
  });
  it('detects info', () => {
    expect(inferLevel('INFO ready on port 3000')).toBe('info');
  });
  it('returns unknown for plain text', () => {
    expect(inferLevel('GET /api/health 200 12ms')).toBe('unknown');
  });
});

describe('matchesContainerGlob', () => {
  it('matches exact', () => {
    expect(matchesContainerGlob('macpool', 'macpool')).toBe(true);
    expect(matchesContainerGlob('macpool', 'shiftfaced')).toBe(false);
  });
  it('matches suffix wildcard', () => {
    expect(matchesContainerGlob('shared-postgres', '*-postgres')).toBe(true);
    expect(matchesContainerGlob('glitchtip-postgres', '*-postgres')).toBe(true);
    expect(matchesContainerGlob('postgres', '*-postgres')).toBe(false);
  });
  it('matches prefix wildcard', () => {
    expect(matchesContainerGlob('macpool-staging', 'macpool-*')).toBe(true);
  });
  it('matches middle wildcard', () => {
    expect(matchesContainerGlob('shared-postgres', 'shared-*')).toBe(true);
  });
  it('escapes regex specials', () => {
    expect(matchesContainerGlob('a.b', 'a.b')).toBe(true);
    expect(matchesContainerGlob('axb', 'a.b')).toBe(false);  // literal dot
  });
});

describe('resolveSources', () => {
  const apps = [
    makeApp({ name: 'macpool', containers: ['macpool'] }),
    makeApp({ name: 'shiftfaced', containers: ['shiftfaced-server', 'shiftfaced-worker'] }),
    makeApp({ name: 'docker-databases', containers: ['shared-postgres', 'shared-redis'] }),
  ];

  it('returns all sources when selection is empty', () => {
    const r = resolveSources(apps);
    expect(r).toHaveLength(5);
  });
  it('filters by app names', () => {
    const r = resolveSources(apps, { apps: ['macpool', 'shiftfaced'] });
    expect(r.map(s => s.container).sort()).toEqual(['macpool', 'shiftfaced-server', 'shiftfaced-worker']);
  });
  it('filters by container glob', () => {
    const r = resolveSources(apps, { containers: ['*-postgres'] });
    expect(r).toEqual([{ app: 'docker-databases', container: 'shared-postgres' }]);
  });
  it('intersects apps + containers', () => {
    const r = resolveSources(apps, { apps: ['shiftfaced'], containers: ['*-worker'] });
    expect(r).toEqual([{ app: 'shiftfaced', container: 'shiftfaced-worker' }]);
  });
});

// Fake spawn for the tailer tests. Pushes data, then schedules close on a
// later tick so data events have time to propagate to the consumer.
function fakeSpawnFactory(scripts: Map<string, { stdout: string[]; stderr?: string[] }>) {
  return ((cmd: string, args: string[]): any => {
    const container = args[args.length - 1];
    const script = scripts.get(container) ?? { stdout: [] };
    const proc = new EventEmitter() as any;
    proc.stdout = new Readable({ read() {} });
    proc.stderr = new Readable({ read() {} });
    proc.kill = vi.fn();
    queueMicrotask(() => {
      for (const chunk of script.stdout) proc.stdout.push(Buffer.from(chunk));
      for (const chunk of script.stderr ?? []) proc.stderr.push(Buffer.from(chunk));
      proc.stdout.push(null);
      proc.stderr.push(null);
      // Defer close so the data events drain to consumers first.
      setTimeout(() => proc.emit('close', 0), 5);
    });
    return proc;
  }) as any;
}

describe('startMultiTail', () => {
  it('emits each line with the right source attribution', async () => {
    const lines: LogLine[] = [];
    const sources: LogSource[] = [{ app: 'a', container: 'a' }, { app: 'b', container: 'b' }];
    const fakeSpawn = fakeSpawnFactory(new Map([
      ['a', { stdout: ['hello a\n', 'second a\n'] }],
      ['b', { stdout: ['hello b\n'] }],
    ]));

    const handle = startMultiTail(sources, {}, l => lines.push(l), undefined, fakeSpawn);
    await new Promise(r => setTimeout(r, 10));
    await handle.stop();

    expect(lines.map(l => `${l.container}:${l.text}`).sort()).toEqual([
      'a:hello a',
      'a:second a',
      'b:hello b',
    ]);
  });

  it('handles partial lines split across chunks', async () => {
    const lines: LogLine[] = [];
    const fakeSpawn = fakeSpawnFactory(new Map([
      ['x', { stdout: ['par', 'tial line\nfull next line\n'] }],
    ]));
    const handle = startMultiTail([{ app: 'x', container: 'x' }], {}, l => lines.push(l), undefined, fakeSpawn);
    await new Promise(r => setTimeout(r, 10));
    await handle.stop();
    expect(lines.map(l => l.text)).toEqual(['partial line', 'full next line']);
  });

  it('flushes a final partial line on close', async () => {
    const lines: LogLine[] = [];
    const fakeSpawn = fakeSpawnFactory(new Map([
      ['x', { stdout: ['a\n', 'no-newline-at-end'] }],
    ]));
    startMultiTail([{ app: 'x', container: 'x' }], {}, l => lines.push(l), undefined, fakeSpawn);
    await new Promise(r => setTimeout(r, 10));
    expect(lines.map(l => l.text)).toEqual(['a', 'no-newline-at-end']);
  });

  it('drops lines below the minimum level', async () => {
    const lines: LogLine[] = [];
    const fakeSpawn = fakeSpawnFactory(new Map([
      ['x', { stdout: ['INFO chatter\n', 'WARN something\n', 'ERROR boom\n'] }],
    ]));
    startMultiTail([{ app: 'x', container: 'x' }], { level: 'warn' }, l => lines.push(l), undefined, fakeSpawn);
    await new Promise(r => setTimeout(r, 10));
    expect(lines.map(l => l.text)).toEqual(['WARN something', 'ERROR boom']);
  });

  it('applies grep substring filter', async () => {
    const lines: LogLine[] = [];
    const fakeSpawn = fakeSpawnFactory(new Map([
      ['x', { stdout: ['alpha\n', 'beta\n', 'gamma\n'] }],
    ]));
    startMultiTail([{ app: 'x', container: 'x' }], { grep: 'bet' }, l => lines.push(l), undefined, fakeSpawn);
    await new Promise(r => setTimeout(r, 10));
    expect(lines.map(l => l.text)).toEqual(['beta']);
  });

  it('passes --since to docker', async () => {
    const lines: LogLine[] = [];
    let capturedArgs: string[] = [];
    const fakeSpawn = ((cmd: string, args: string[]) => {
      capturedArgs = args;
      const p = new EventEmitter() as any;
      p.stdout = new Readable({ read() {} });
      p.stderr = new Readable({ read() {} });
      p.kill = vi.fn();
      queueMicrotask(() => { p.stdout.push(null); p.stderr.push(null); p.emit('close', 0); });
      return p;
    }) as any;
    startMultiTail([{ app: 'x', container: 'x' }], { since: '15m' }, l => lines.push(l), undefined, fakeSpawn);
    await new Promise(r => setTimeout(r, 10));
    expect(capturedArgs).toContain('--since');
    expect(capturedArgs).toContain('15m');
  });

  it('teardown via stop() kills processes and is idempotent', async () => {
    const killSpies: any[] = [];
    const fakeSpawn = ((cmd: string, args: string[]) => {
      const p = new EventEmitter() as any;
      p.stdout = new Readable({ read() {} });
      p.stderr = new Readable({ read() {} });
      p.kill = vi.fn(() => { p.emit('close', null); return true; });
      killSpies.push(p.kill);
      return p;
    }) as any;
    const handle = startMultiTail(
      [{ app: 'a', container: 'a' }, { app: 'b', container: 'b' }],
      {}, () => {}, undefined, fakeSpawn,
    );
    expect(handle.active()).toBe(2);
    await handle.stop();
    expect(killSpies.every(s => s.mock.calls.length >= 1)).toBe(true);
    // Idempotent
    await handle.stop();
  });
});
