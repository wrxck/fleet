import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import Database from 'better-sqlite3';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_DB_PATH = join(__dirname, '..', '..', '..', 'data', 'fleet.db');

let _db: Database.Database | null = null;
let _currentPath: string | null = null;

const SCHEMA: readonly string[] = Object.freeze([
  `CREATE TABLE IF NOT EXISTS schema_version (
     version INTEGER PRIMARY KEY
   )`,
  `CREATE TABLE IF NOT EXISTS routine_runs (
     run_id          TEXT PRIMARY KEY,
     routine_id      TEXT NOT NULL,
     target          TEXT,
     started_at      TEXT NOT NULL,
     ended_at        TEXT,
     status          TEXT NOT NULL,
     exit_code       INTEGER,
     duration_ms     INTEGER,
     error           TEXT,
     runner_kind     TEXT NOT NULL,
     scheduler_kind  TEXT NOT NULL,
     triggered_by    TEXT NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS idx_runs_routine_started
     ON routine_runs(routine_id, started_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_runs_status
     ON routine_runs(status, started_at DESC)`,
  `CREATE TABLE IF NOT EXISTS routine_run_events (
     run_id          TEXT NOT NULL,
     seq             INTEGER NOT NULL,
     at              TEXT NOT NULL,
     kind            TEXT NOT NULL,
     payload         TEXT NOT NULL,
     PRIMARY KEY (run_id, seq),
     FOREIGN KEY (run_id) REFERENCES routine_runs(run_id) ON DELETE CASCADE
   )`,
  `CREATE TABLE IF NOT EXISTS routine_cost (
     run_id               TEXT PRIMARY KEY,
     input_tokens         INTEGER NOT NULL DEFAULT 0,
     output_tokens        INTEGER NOT NULL DEFAULT 0,
     cache_create_tokens  INTEGER NOT NULL DEFAULT 0,
     cache_read_tokens    INTEGER NOT NULL DEFAULT 0,
     usd                  REAL NOT NULL DEFAULT 0,
     FOREIGN KEY (run_id) REFERENCES routine_runs(run_id) ON DELETE CASCADE
   )`,
  `CREATE TABLE IF NOT EXISTS signal_cache (
     repo            TEXT NOT NULL,
     kind            TEXT NOT NULL,
     state           TEXT NOT NULL,
     value           TEXT,
     detail          TEXT NOT NULL DEFAULT '',
     collected_at    TEXT NOT NULL,
     ttl_ms          INTEGER NOT NULL,
     PRIMARY KEY (repo, kind)
   )`,
  `CREATE TABLE IF NOT EXISTS signal_history (
     repo            TEXT NOT NULL,
     kind            TEXT NOT NULL,
     state           TEXT NOT NULL,
     value           TEXT,
     detail          TEXT NOT NULL DEFAULT '',
     collected_at    TEXT NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS idx_signal_history
     ON signal_history(repo, kind, collected_at DESC)`,
]);

const CURRENT_VERSION = 1;

function ensureDirFor(path: string): void {
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

function runMigrations(db: Database.Database): void {
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('synchronous = NORMAL');

  db.exec('BEGIN');
  try {
    for (const stmt of SCHEMA) db.exec(stmt);
    const row = db.prepare('SELECT version FROM schema_version LIMIT 1').get() as { version: number } | undefined;
    if (!row) {
      db.prepare('INSERT INTO schema_version(version) VALUES (?)').run(CURRENT_VERSION);
    } else if (row.version !== CURRENT_VERSION) {
      db.prepare('UPDATE schema_version SET version = ?').run(CURRENT_VERSION);
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

export interface OpenOptions {
  path?: string;
  readonly?: boolean;
}

export function openDb(opts: OpenOptions = {}): Database.Database {
  const path = opts.path ?? DEFAULT_DB_PATH;
  if (_db && _currentPath === path) return _db;
  if (_db) {
    _db.close();
    _db = null;
  }
  ensureDirFor(path);
  const db = new Database(path, { readonly: opts.readonly ?? false });
  if (!opts.readonly) runMigrations(db);
  _db = db;
  _currentPath = path;
  return db;
}

export function closeDb(): void {
  if (_db) {
    _db.close();
    _db = null;
    _currentPath = null;
  }
}

export function dbPath(): string {
  return _currentPath ?? DEFAULT_DB_PATH;
}

export function currentSchemaVersion(): number {
  return CURRENT_VERSION;
}
