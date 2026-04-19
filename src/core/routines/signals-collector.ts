import type Database from 'better-sqlite3';

import type { SignalProvider } from '../../adapters/types.js';
import type { Signal, SignalKind } from './schema.js';

export interface SignalTarget {
  repoName: string;
  repoPath: string;
}

export interface CollectorOptions {
  providers: readonly SignalProvider[];
  db: Database.Database;
  concurrency?: number;
  now?: () => number;
}

export interface CollectRequest {
  target: SignalTarget;
  kinds?: readonly SignalKind[];
  force?: boolean;
}

export interface CollectSummary {
  total: number;
  fromCache: number;
  collected: number;
  errors: number;
}

function isFresh(signal: Signal, nowMs: number): boolean {
  return new Date(signal.collectedAt).getTime() + signal.ttlMs > nowMs;
}

function rowToSignal(row: {
  repo: string;
  kind: string;
  state: string;
  value: string | null;
  detail: string;
  collected_at: string;
  ttl_ms: number;
}): Signal {
  let parsed: Signal['value'] = null;
  if (row.value !== null) {
    try { parsed = JSON.parse(row.value); } catch { parsed = row.value; }
  }
  return {
    repo: row.repo,
    kind: row.kind as SignalKind,
    state: row.state as Signal['state'],
    value: parsed,
    detail: row.detail,
    collectedAt: row.collected_at,
    ttlMs: row.ttl_ms,
  };
}

export class SignalCollector {
  private readonly providers: Map<SignalKind, SignalProvider>;
  private readonly db: Database.Database;
  private readonly now: () => number;
  private readonly concurrency: number;

  constructor(opts: CollectorOptions) {
    this.providers = new Map(opts.providers.map(p => [p.kind, p]));
    this.db = opts.db;
    this.now = opts.now ?? (() => Date.now());
    this.concurrency = opts.concurrency ?? 4;
  }

  readCached(repoName: string, kinds?: readonly SignalKind[]): Signal[] {
    const params: (string | number)[] = [repoName];
    let sql = 'SELECT repo, kind, state, value, detail, collected_at, ttl_ms FROM signal_cache WHERE repo = ?';
    if (kinds && kinds.length > 0) {
      sql += ` AND kind IN (${kinds.map(() => '?').join(', ')})`;
      params.push(...kinds);
    }
    const rows = this.db.prepare(sql).all(...params) as Parameters<typeof rowToSignal>[0][];
    return rows.map(rowToSignal);
  }

  private persist(signal: Signal): void {
    const stmt = this.db.prepare(`
      INSERT INTO signal_cache (repo, kind, state, value, detail, collected_at, ttl_ms)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(repo, kind) DO UPDATE SET
        state = excluded.state,
        value = excluded.value,
        detail = excluded.detail,
        collected_at = excluded.collected_at,
        ttl_ms = excluded.ttl_ms
    `);
    stmt.run(
      signal.repo,
      signal.kind,
      signal.state,
      signal.value === null ? null : JSON.stringify(signal.value),
      signal.detail,
      signal.collectedAt,
      signal.ttlMs,
    );
    this.db.prepare(`
      INSERT INTO signal_history (repo, kind, state, value, detail, collected_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      signal.repo,
      signal.kind,
      signal.state,
      signal.value === null ? null : JSON.stringify(signal.value),
      signal.detail,
      signal.collectedAt,
    );
  }

  async collect(requests: readonly CollectRequest[]): Promise<CollectSummary> {
    const summary: CollectSummary = { total: 0, fromCache: 0, collected: 0, errors: 0 };
    const queue: { req: CollectRequest; kind: SignalKind; provider: SignalProvider }[] = [];
    const nowMs = this.now();

    for (const req of requests) {
      const kinds = req.kinds ?? Array.from(this.providers.keys());
      const cached = req.force ? [] : this.readCached(req.target.repoName, kinds);
      const cachedByKind = new Map(cached.map(s => [s.kind, s]));
      for (const kind of kinds) {
        summary.total++;
        const c = cachedByKind.get(kind);
        if (c && isFresh(c, nowMs)) {
          summary.fromCache++;
          continue;
        }
        const provider = this.providers.get(kind);
        if (!provider) continue;
        queue.push({ req, kind, provider });
      }
    }

    let i = 0;
    const workers: Promise<void>[] = [];
    for (let w = 0; w < Math.min(this.concurrency, queue.length); w++) {
      workers.push((async () => {
        while (true) {
          const idx = i++;
          if (idx >= queue.length) return;
          const { req, provider } = queue[idx];
          try {
            const signal = await provider.collect(req.target.repoPath, req.target.repoName);
            this.persist(signal);
            summary.collected++;
          } catch {
            summary.errors++;
          }
        }
      })());
    }
    await Promise.all(workers);

    return summary;
  }

  async snapshot(targets: readonly SignalTarget[]): Promise<Map<string, Signal[]>> {
    await this.collect(targets.map(target => ({ target })));
    const result = new Map<string, Signal[]>();
    for (const target of targets) {
      result.set(target.repoName, this.readCached(target.repoName));
    }
    return result;
  }
}
