import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type Database from 'better-sqlite3';

import { createStdoutNotifier } from '../../adapters/notifier/index';
import { builtInSignalProviders } from '../../adapters/signals/index';
import type { RoutineEngine } from '../../core/routines/engine';
import { closeDb, openDb } from '../../core/routines/db';
import { builtInDefaultRoutines } from '../../core/routines/defaults';
import { RoutineEngine as Engine } from '../../core/routines/engine';
import { createClaudeCliRunner } from '../../adapters/runner/claude-cli';
import { createMcpCallRunner } from '../../adapters/runner/mcp-call';
import { createShellRunner } from '../../adapters/runner/shell';
import { createSystemdTimerAdapter } from '../../adapters/scheduler/systemd-timer';
import { RoutineStore } from '../../core/routines/store';
import { SignalCollector } from '../../core/routines/signals-collector';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_DATA_DIR = join(__dirname, '..', '..', '..', 'data');

export interface RoutinesRuntime {
  engine: RoutineEngine;
  store: RoutineStore;
  collector: SignalCollector;
  db: Database.Database;
  seeded: { seeded: number; skipped: number };
  close(): void;
}

export interface RuntimeOptions {
  dataDir?: string;
  seedDefaults?: boolean;
}

export function createRuntime(opts: RuntimeOptions = {}): RoutinesRuntime {
  const dataDir = opts.dataDir ?? DEFAULT_DATA_DIR;
  const db = openDb({ path: join(dataDir, 'fleet.db') });
  const store = new RoutineStore(join(dataDir, 'routines.json'));
  const seeded = opts.seedDefaults === false
    ? { seeded: 0, skipped: 0 }
    : store.seedDefaults(builtInDefaultRoutines());

  const scheduler = createSystemdTimerAdapter();
  const engine = new Engine({
    store,
    db,
    runners: [createShellRunner(), createClaudeCliRunner(), createMcpCallRunner()],
    scheduler: scheduler.available() ? scheduler : null,
    notifiers: [createStdoutNotifier()],
  });
  const collector = new SignalCollector({ providers: builtInSignalProviders(), db, concurrency: 4 });

  return {
    engine,
    store,
    collector,
    db,
    seeded,
    close: () => closeDb(),
  };
}
