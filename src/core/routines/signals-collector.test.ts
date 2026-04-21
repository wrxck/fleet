import { rmSync } from 'node:fs';
import { join } from 'node:path';

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import type { SignalProvider } from '../../adapters/types.js';
import { closeDb, openDb } from './db.js';
import type { Signal } from './schema.js';
import { SignalCollector } from './signals-collector.js';
import { mkExecTmpDir } from './test-utils.js';

function mkProvider(kind: Signal['kind'], ttlMs: number, fetcher: () => Promise<Signal>): SignalProvider {
  return { kind, ttlMs, strategy: 'pull', collect: fetcher };
}

describe('SignalCollector', () => {
  let dir: string;
  let db: ReturnType<typeof openDb>;

  beforeEach(() => {
    dir = mkExecTmpDir('fleet-collector-');
    db = openDb({ path: join(dir, 'fleet.db') });
  });

  afterEach(() => {
    closeDb();
    rmSync(dir, { recursive: true, force: true });
  });

  it('collects from provider and caches in sqlite', async () => {
    let callCount = 0;
    const provider = mkProvider('git-clean', 10_000, async () => {
      callCount++;
      return {
        repo: 'demo',
        kind: 'git-clean',
        state: 'ok',
        value: true,
        detail: '',
        collectedAt: new Date().toISOString(),
        ttlMs: 10_000,
      };
    });

    const collector = new SignalCollector({ providers: [provider], db });
    const summary = await collector.collect([{ target: { repoName: 'demo', repoPath: '/tmp/nope' } }]);

    expect(summary.collected).toBe(1);
    expect(summary.fromCache).toBe(0);
    expect(callCount).toBe(1);

    const cached = collector.readCached('demo');
    expect(cached).toHaveLength(1);
    expect(cached[0].state).toBe('ok');
  });

  it('serves from cache when within TTL', async () => {
    let callCount = 0;
    const provider = mkProvider('git-clean', 60_000, async () => {
      callCount++;
      return {
        repo: 'demo', kind: 'git-clean', state: 'ok', value: true, detail: '',
        collectedAt: new Date().toISOString(), ttlMs: 60_000,
      };
    });

    const collector = new SignalCollector({ providers: [provider], db });
    await collector.collect([{ target: { repoName: 'demo', repoPath: '/x' } }]);
    const second = await collector.collect([{ target: { repoName: 'demo', repoPath: '/x' } }]);

    expect(callCount).toBe(1);
    expect(second.fromCache).toBe(1);
    expect(second.collected).toBe(0);
  });

  it('refetches when force=true even if within TTL', async () => {
    let callCount = 0;
    const provider = mkProvider('git-clean', 60_000, async () => {
      callCount++;
      return {
        repo: 'demo', kind: 'git-clean', state: 'ok', value: true, detail: '',
        collectedAt: new Date().toISOString(), ttlMs: 60_000,
      };
    });
    const collector = new SignalCollector({ providers: [provider], db });
    await collector.collect([{ target: { repoName: 'demo', repoPath: '/x' } }]);
    await collector.collect([{ target: { repoName: 'demo', repoPath: '/x' }, force: true }]);
    expect(callCount).toBe(2);
  });

  it('records errors without throwing', async () => {
    const provider = mkProvider('git-clean', 10_000, async () => { throw new Error('boom'); });
    const collector = new SignalCollector({ providers: [provider], db });
    const summary = await collector.collect([{ target: { repoName: 'demo', repoPath: '/x' } }]);
    expect(summary.errors).toBe(1);
    expect(summary.collected).toBe(0);
  });

  it('appends every collection to signal_history', async () => {
    const provider = mkProvider('git-clean', 0, async () => ({
      repo: 'demo', kind: 'git-clean', state: 'ok', value: true, detail: '',
      collectedAt: new Date().toISOString(), ttlMs: 0,
    }));
    const collector = new SignalCollector({ providers: [provider], db });
    await collector.collect([{ target: { repoName: 'demo', repoPath: '/x' } }]);
    await collector.collect([{ target: { repoName: 'demo', repoPath: '/x' } }]);
    await collector.collect([{ target: { repoName: 'demo', repoPath: '/x' } }]);
    const row = db.prepare('SELECT COUNT(*) AS c FROM signal_history WHERE repo = ?').get('demo') as { c: number };
    expect(row.c).toBe(3);
  });

  it('snapshot returns a signals map keyed by repo', async () => {
    const provider: SignalProvider = {
      kind: 'git-clean',
      ttlMs: 10_000,
      strategy: 'pull',
      async collect(_path, name) {
        return {
          repo: name, kind: 'git-clean', state: 'ok', value: true, detail: '',
          collectedAt: new Date().toISOString(), ttlMs: 10_000,
        };
      },
    };
    const collector = new SignalCollector({ providers: [provider], db });
    const snap = await collector.snapshot([
      { repoName: 'demo', repoPath: '/x' },
      { repoName: 'other', repoPath: '/y' },
    ]);
    expect(snap.size).toBe(2);
    expect(snap.get('demo')).toHaveLength(1);
    expect(snap.get('other')).toHaveLength(1);
  });

  it('respects concurrency without deadlocking', async () => {
    let active = 0;
    let peak = 0;
    const provider = mkProvider('git-clean', 0, async () => {
      active++;
      peak = Math.max(peak, active);
      await new Promise(r => setTimeout(r, 20));
      active--;
      return {
        repo: 'x', kind: 'git-clean', state: 'ok', value: true, detail: '',
        collectedAt: new Date().toISOString(), ttlMs: 0,
      };
    });
    const collector = new SignalCollector({ providers: [provider], db, concurrency: 2 });
    const targets: { target: { repoName: string; repoPath: string } }[] = [];
    for (let i = 0; i < 6; i++) targets.push({ target: { repoName: `r${i}`, repoPath: '/x' } });
    const summary = await collector.collect(targets);
    expect(summary.collected).toBe(6);
    expect(peak).toBeLessThanOrEqual(2);
  });
});
