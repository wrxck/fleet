import type Database from 'better-sqlite3';

export interface CostRollup {
  usdToday: number;
  usdWeek: number;
  usdMonth: number;
  runsToday: number;
  runsWeek: number;
  runsMonth: number;
}

export interface CostByRoutine {
  routineId: string;
  runs: number;
  usd: number;
  inputTokens: number;
  outputTokens: number;
}

export interface DailyCostBucket {
  date: string;
  usd: number;
  runs: number;
}

function isoDaysAgo(n: number): string {
  return new Date(Date.now() - n * 86_400_000).toISOString();
}

export function costRollup(db: Database.Database): CostRollup {
  const windows = {
    day: isoDaysAgo(1),
    week: isoDaysAgo(7),
    month: isoDaysAgo(30),
  };
  const stmt = db.prepare(`
    SELECT COALESCE(SUM(c.usd), 0) AS usd, COUNT(DISTINCT r.run_id) AS runs
    FROM routine_runs r
    LEFT JOIN routine_cost c ON c.run_id = r.run_id
    WHERE r.started_at >= ?
  `);
  const dayRow = stmt.get(windows.day) as { usd: number; runs: number };
  const weekRow = stmt.get(windows.week) as { usd: number; runs: number };
  const monthRow = stmt.get(windows.month) as { usd: number; runs: number };
  return {
    usdToday: dayRow.usd,
    usdWeek: weekRow.usd,
    usdMonth: monthRow.usd,
    runsToday: dayRow.runs,
    runsWeek: weekRow.runs,
    runsMonth: monthRow.runs,
  };
}

export function costByRoutine(db: Database.Database, days = 30, limit = 20): CostByRoutine[] {
  const since = isoDaysAgo(days);
  const rows = db.prepare(`
    SELECT r.routine_id AS routineId,
           COUNT(DISTINCT r.run_id) AS runs,
           COALESCE(SUM(c.usd), 0) AS usd,
           COALESCE(SUM(c.input_tokens), 0) AS inputTokens,
           COALESCE(SUM(c.output_tokens), 0) AS outputTokens
    FROM routine_runs r
    LEFT JOIN routine_cost c ON c.run_id = r.run_id
    WHERE r.started_at >= ?
    GROUP BY r.routine_id
    ORDER BY usd DESC
    LIMIT ?
  `).all(since, limit) as CostByRoutine[];
  return rows;
}

export function dailyCostSeries(db: Database.Database, days = 14): DailyCostBucket[] {
  const buckets: DailyCostBucket[] = [];
  const now = new Date();
  for (let i = days - 1; i >= 0; i--) {
    const day = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
    const start = day.toISOString();
    const end = new Date(day.getTime() + 86_400_000).toISOString();
    const row = db.prepare(`
      SELECT COALESCE(SUM(c.usd), 0) AS usd, COUNT(DISTINCT r.run_id) AS runs
      FROM routine_runs r
      LEFT JOIN routine_cost c ON c.run_id = r.run_id
      WHERE r.started_at >= ? AND r.started_at < ?
    `).get(start, end) as { usd: number; runs: number };
    buckets.push({
      date: day.toISOString().slice(0, 10),
      usd: row.usd,
      runs: row.runs,
    });
  }
  return buckets;
}
