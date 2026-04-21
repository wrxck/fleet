import type Database from 'better-sqlite3';

export type IncidentKind = 'routine-failed' | 'routine-timeout' | 'signal-error' | 'signal-warn';

export interface Incident {
  at: string;
  kind: IncidentKind;
  subject: string;
  detail: string;
}

export interface IncidentQueryOptions {
  sinceDays?: number;
  limit?: number;
}

export function loadIncidents(db: Database.Database, opts: IncidentQueryOptions = {}): Incident[] {
  const sinceDays = opts.sinceDays ?? 7;
  const limit = opts.limit ?? 100;
  const since = new Date(Date.now() - sinceDays * 86_400_000).toISOString();

  const routineRows = db.prepare(`
    SELECT started_at AS at, routine_id AS subject, status, error, target
    FROM routine_runs
    WHERE started_at >= ? AND status IN ('failed', 'timeout', 'aborted')
    ORDER BY started_at DESC
    LIMIT ?
  `).all(since, limit) as Array<{
    at: string;
    subject: string;
    status: string;
    error: string | null;
    target: string | null;
  }>;

  const incidents: Incident[] = routineRows.map(r => ({
    at: r.at,
    kind: r.status === 'timeout' ? 'routine-timeout' : 'routine-failed',
    subject: `${r.subject}${r.target ? ` · ${r.target}` : ''}`,
    detail: r.error ?? r.status,
  }));

  const signalRows = db.prepare(`
    SELECT collected_at AS at, repo, kind AS signal_kind, state, detail
    FROM signal_history
    WHERE collected_at >= ? AND state IN ('error', 'warn')
    ORDER BY collected_at DESC
    LIMIT ?
  `).all(since, limit) as Array<{
    at: string;
    repo: string;
    signal_kind: string;
    state: 'error' | 'warn';
    detail: string;
  }>;

  for (const row of signalRows) {
    incidents.push({
      at: row.at,
      kind: row.state === 'error' ? 'signal-error' : 'signal-warn',
      subject: `${row.repo} · ${row.signal_kind}`,
      detail: row.detail,
    });
  }

  incidents.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
  return incidents.slice(0, limit);
}
