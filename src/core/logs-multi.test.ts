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
} from './logs-multi';
import { resolveRedaction } from './redaction';
import type { AppEntry } from './registry';

function makeApp(overrides: Partial<AppEntry> = {}): AppEntry {
  return {
    name: 'poolside',
    displayName: 'poolside',
    composePath: '/x',
    composeFile: null,
    serviceName: 'poolside',
    domains: [],
    port: null,
    usesSharedDb: false,
    type: 'nextjs',
    containers: ['poolside'],
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
    expect(matchesContainerGlob('poolside', 'poolside')).toBe(true);
    expect(matchesContainerGlob('poolside', 'brewco')).toBe(false);
  });
  it('matches suffix wildcard', () => {
    expect(matchesContainerGlob('shared-postgres', '*-postgres')).toBe(true);
    expect(matchesContainerGlob('glitchtip-postgres', '*-postgres')).toBe(true);
    expect(matchesContainerGlob('postgres', '*-postgres')).toBe(false);
  });
  it('matches prefix wildcard', () => {
    expect(matchesContainerGlob('poolside-staging', 'poolside-*')).toBe(true);
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
    makeApp({ name: 'poolside', containers: ['poolside'] }),
    makeApp({ name: 'brewco', containers: ['brewco-server', 'brewco-worker'] }),
    makeApp({ name: 'docker-databases', containers: ['shared-postgres', 'shared-redis'] }),
  ];

  it('returns all sources when selection is empty', () => {
    const r = resolveSources(apps);
    expect(r).toHaveLength(5);
  });
  it('filters by app names', () => {
    const r = resolveSources(apps, { apps: ['poolside', 'brewco'] });
    expect(r.map(s => s.container).sort()).toEqual(['brewco-server', 'brewco-worker', 'poolside']);
  });
  it('filters by container glob', () => {
    const r = resolveSources(apps, { containers: ['*-postgres'] });
    expect(r.map(({ app, container }) => ({ app, container })))
      .toEqual([{ app: 'docker-databases', container: 'shared-postgres' }]);
  });
  it('intersects apps + containers', () => {
    const r = resolveSources(apps, { apps: ['brewco'], containers: ['*-worker'] });
    expect(r.map(({ app, container }) => ({ app, container })))
      .toEqual([{ app: 'brewco', container: 'brewco-worker' }]);
  });
  it('attaches each app resolved redaction config to its sources', () => {
    const withCfg = [
      makeApp({ name: 'poolside', containers: ['poolside'] }),
      makeApp({ name: 'brewco', containers: ['brewco-server'], logging: { redaction: { enabled: false } } }),
    ];
    const r = resolveSources(withCfg);
    expect(r.find(s => s.app === 'poolside')?.redaction?.enabled).toBe(true);
    expect(r.find(s => s.app === 'brewco')?.redaction?.enabled).toBe(false);
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

describe('startMultiTail redaction', () => {
  const TOKEN = 'ghp_1234567890abcdefghijklmnopqrstuvwxyz';

  async function tail(
    stdout: string[],
    opts: Parameters<typeof startMultiTail>[1] = {},
    source: Partial<LogSource> = {},
  ): Promise<string[]> {
    const lines: LogLine[] = [];
    const fakeSpawn = fakeSpawnFactory(new Map([['x', { stdout }]]));
    const handle = startMultiTail(
      [{ app: 'x', container: 'x', ...source }],
      opts,
      l => lines.push(l),
      undefined,
      fakeSpawn,
    );
    await new Promise(r => setTimeout(r, 15));
    await handle.stop();
    return lines.map(l => l.text);
  }

  it('redacts each line as it arrives', async () => {
    const out = await tail([`boot ok\nGH_TOKEN=${TOKEN}\nmail alice@example.com\n`]);
    expect(out[0]).toBe('boot ok');
    expect(out[1]).toMatch(/^GH_TOKEN=\[REDACTED:provider_token#[0-9a-f]{4}\]$/);
    expect(out[2]).toMatch(/^mail \[REDACTED:email#[0-9a-f]{4}\]$/);
    expect(out.join('\n')).not.toContain(TOKEN);
  });

  it('redacts a line reassembled from split chunks', async () => {
    const out = await tail([`GH_TOKEN=${TOKEN.slice(0, 12)}`, `${TOKEN.slice(12)}\n`]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatch(/^GH_TOKEN=\[REDACTED:provider_token#[0-9a-f]{4}\]$/);
  });

  it('redacts the final partial line flushed on close', async () => {
    const out = await tail([`first\n`, `GH_TOKEN=${TOKEN}`]);
    expect(out[1]).not.toContain(TOKEN);
  });

  it('suppresses a multi-line pem block across the stream', async () => {
    const out = await tail([
      'starting\n',
      '-----BEGIN RSA PRIVATE KEY-----\n',
      'MIIEowIBAAKCAQEAy8Dbv8prpJ/0kKhlGeJYozo2t60EG8L0561g13R29LvMR5hy\n',
      '-----END RSA PRIVATE KEY-----\n',
      'ready\n',
    ]);
    expect(out).toHaveLength(3);
    expect(out[0]).toBe('starting');
    expect(out[1]).toMatch(/^\[REDACTED:private_key#[0-9a-f]{4}\]$/);
    expect(out[2]).toBe('ready');
    expect(out.join('\n')).not.toContain('MIIEow');
  });

  it('greps against the raw line, then emits the redacted one', async () => {
    const out = await tail(
      ['unrelated\n', 'login alice@example.com ok\n'],
      { grep: 'alice@example.com' },
    );
    expect(out).toHaveLength(1);
    expect(out[0]).not.toContain('alice@example.com');
    expect(out[0]).toContain('login');
  });

  it('uses the source own config over the opts fallback', async () => {
    const off = resolveRedaction({ enabled: false });
    const out = await tail([`GH_TOKEN=${TOKEN}\n`], {}, { redaction: off });
    expect(out[0]).toBe(`GH_TOKEN=${TOKEN}`);
  });

  it('falls back to the opts config when the source carries none', async () => {
    const off = resolveRedaction({ enabled: false });
    const out = await tail([`GH_TOKEN=${TOKEN}\n`], { redaction: off });
    expect(out[0]).toBe(`GH_TOKEN=${TOKEN}`);
  });
});
