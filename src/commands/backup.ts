import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  loadConfig,
  saveConfig,
  listConfiguredApps,
  validateAppName,
} from '../core/backup/config';
import { exportAllZones } from '../core/backup/cloudflare';
import { detectAppConfig } from '../core/backup/detect';
import { load as loadRegistry } from '../core/registry';
import { dumpStreamCommand, dumpFilename } from '../core/backup/dump';
import {
  initRepo,
  snapshot,
  listSnapshots,
  restore,
  prune,
  check,
  checkIntegrity,
  isAppendOnly,
  stats,
} from '../core/backup/repo';
import { installScheduleUnits, disableSchedule } from '../core/backup/schedule';
import {
  systemConfig,
  rootHomeConfig,
  mattHomeConfig,
  sharedPostgresConfig,
  sharedMysqlConfig,
  sharedMongoConfig,
} from '../core/backup/system';
import { isPseudoApp } from '../core/backup/types';
import {
  generateAndStorePassword,
  vaultPath,
} from '../core/backup/unlock';
import { FleetError } from '../core/errors';
import { execSafe } from '../core/exec';
import { c, heading, table, info, success, error, warn } from '../ui/output';

const HELP = `fleet backup - encrypted off-host backups via restic + age

Usage: fleet backup <subcommand> [args]

Subcommands:
  init <app>                       generate password vault + restic repo for an app
  init-system                      configure the three pseudo-apps (system, root-home, matt-home)
  register <app> [--dry-run]       auto-detect and register a fleet-known app (paths, db dump, volumes)
  register-all [--dry-run]         run register for every app in the fleet registry
  snapshot <app> [--dry-run]       one-off backup now
  list <app>                       list snapshots
  restore <app> <snapshot> [opts]  restore. opts: --to <dir>, --include <path>, --dry-run, --verify
  prune <app>                      apply retention policy
  verify <app>                     restic check (full repo integrity)
  integrity <app> [--read N]       restic check with --read-data-subset=N% (default 5)
  schedule <app> <schedule> [--dry-run]   set+enable systemd timer (hourly|daily|weekly)
  schedule-all [--dry-run]         schedule every configured app per its config
  unschedule <app>                 disable + remove timer
  status                           dashboard of all configured backups
  test <app>                       e2e: snapshot, list, restore-to-tmp, diff, cleanup
`;

export function backupCommand(args: string[]): void {
  const [sub, ...rest] = args;
  switch (sub) {
    case 'init':         return cmdInit(rest);
    case 'init-system':  return cmdInitSystem();
    case 'register':     return cmdRegister(rest);
    case 'register-all': return cmdRegisterAll(rest);
    case 'snapshot':     return cmdSnapshot(rest);
    case 'snapshot-all': return cmdSnapshotAll(rest);
    case 'list':         return cmdList(rest);
    case 'restore':      return cmdRestore(rest);
    case 'prune':        return cmdPrune(rest);
    case 'verify':       return cmdVerify(rest);
    case 'schedule':     return cmdSchedule(rest);
    case 'schedule-all': return cmdScheduleAll(rest);
    case 'unschedule':   return cmdUnschedule(rest);
    case 'integrity':    return cmdIntegrity(rest);
    case 'status':       return cmdStatus();
    case 'test':         return cmdTest(rest);
    case '--help':
    case '-h':
    case undefined:
      process.stdout.write(HELP);
      return;
    default:
      error(`unknown subcommand: ${sub}`);
      process.stdout.write(HELP);
      process.exit(2);
  }
}

function cmdInit(args: string[]): void {
  const [app] = args;
  validateAppName(app);
  // idempotent: don't regenerate the per-app password if a vault entry
  // already exists, because that would orphan all prior snapshots.
  if (!existsSync(vaultPath(app))) {
    generateAndStorePassword(app);
  }
  initRepo(app);
  success(`vault + repo initialised for ${app}`);
}

function cmdInitSystem(): void {
  const configs = [
    systemConfig(),
    rootHomeConfig(),
    mattHomeConfig(),
    sharedPostgresConfig(),
    sharedMysqlConfig(),
    sharedMongoConfig(),
  ];
  for (const cfg of configs) {
    if (!loadConfig(cfg.app)) {
      saveConfig(cfg);
      info(`wrote default config for ${cfg.app}`);
    }
    if (!existsSync(vaultPath(cfg.app))) {
      generateAndStorePassword(cfg.app);
      info(`generated vault entry for ${cfg.app}`);
    }
    initRepo(cfg.app);
    info(`initialised restic repo for ${cfg.app}`);
  }
  success(`pseudo-apps ready: 3 system + 3 shared-db safety nets`);
}

function cmdRegister(args: string[]): void {
  const dryRun = args.includes('--dry-run');
  const [app] = args.filter(a => !a.startsWith('--'));
  validateAppName(app);
  if (isPseudoApp(app)) {
    throw new FleetError(`use init-system for pseudo-app ${app}`);
  }
  const cfg = detectAppConfig(app);
  if (!cfg) throw new FleetError(`app not in fleet registry: ${app}`);
  if (dryRun) {
    heading(`[dry-run] would register ${app}`);
    process.stdout.write(JSON.stringify(cfg, null, 2) + '\n');
    return;
  }
  saveConfig(cfg);
  generateAndStorePassword(app);
  initRepo(app);
  success(`registered ${app}: ${cfg.paths.length} paths, ${cfg.volumes?.length ?? 0} volumes, dump=${cfg.preDump?.type ?? 'none'}, schedule=${cfg.schedule}`);
}

function cmdRegisterAll(args: string[]): void {
  const dryRun = args.includes('--dry-run');
  const reg = loadRegistry();
  if (reg.apps.length === 0) {
    warn('fleet registry is empty');
    return;
  }
  heading(`${dryRun ? '[dry-run] ' : ''}registering ${reg.apps.length} apps`);
  const rows: string[][] = [];
  for (const app of reg.apps) {
    try {
      const cfg = detectAppConfig(app.name);
      if (!cfg) { rows.push([app.name, 'SKIP', 'not detectable']); continue; }
      if (!dryRun) {
        saveConfig(cfg);
        generateAndStorePassword(cfg.app);
        initRepo(cfg.app);
      }
      rows.push([
        app.name,
        dryRun ? 'plan' : 'done',
        `paths=${cfg.paths.length} vols=${cfg.volumes?.length ?? 0} dump=${cfg.preDump?.type ?? '-'} sched=${cfg.schedule}`,
      ]);
    } catch (e) {
      rows.push([app.name, 'FAIL', (e as Error).message]);
    }
  }
  table(['app', 'status', 'plan'], rows);
}

function cmdSnapshot(args: string[]): void {
  const dryRun = args.includes('--dry-run');
  const [app] = args.filter(a => !a.startsWith('--'));
  const cfg = mustLoadConfig(app);
  if (cfg.disabled) { warn(`${app} is disabled; skipping`); return; }

  const tags = [`app=${app}`];
  let snapCount = 0;
  const prefix = dryRun ? '[dry-run] ' : '';

  // file-system snapshot
  if (cfg.paths.length > 0) {
    const existing = cfg.paths.filter(p => existsSync(p));
    const skipped = cfg.paths.length - existing.length;
    if (skipped > 0) warn(`${skipped} configured path(s) missing on disk, skipping those`);
    if (existing.length > 0) {
      const snap = snapshot(app, {
        paths: existing,
        excludes: cfg.exclude,
        tags: [...tags, 'kind=fs'],
        dryRun,
      });
      info(`${prefix}fs snapshot ${snap.shortId} (${humanBytes(snap.sizeBytes ?? 0)} ${dryRun ? 'would be added' : 'added'})`);
      snapCount++;
    }
  }

  // db dump — streamed through sh -c so multi-gb dumps don't hit
  // spawnsync's 1mb buffer ceiling.
  if (cfg.preDump) {
    if (dryRun) {
      info(`${prefix}would run ${cfg.preDump.type} dump on ${cfg.preDump.container} -> ${dumpFilename(cfg.preDump)}`);
      snapCount++;
    } else {
      const fn = dumpFilename(cfg.preDump);
      const snap = snapshot(app, {
        paths: [],
        tags: [...tags, 'kind=dump', `dump=${cfg.preDump.type}`],
        stdinFilename: fn,
        stdinCommand: dumpStreamCommand(cfg.preDump),
      });
      info(`db dump snapshot ${snap.shortId} (${humanBytes(snap.sizeBytes ?? 0)} added) -> ${fn}`);
      snapCount++;
    }
  }

  // system-app extras: cf zone export. cf zones json is small (<1mb) so we
  // pass it via in-memory stdinData rather than streaming.
  if (app === 'system') {
    if (dryRun) {
      info(`${prefix}would export all cloudflare zones (api token required at /root/.secrets/cloudflare.ini)`);
      snapCount++;
    } else {
      try {
        const zones = exportAllZones();
        const snap = snapshot(app, {
          paths: [],
          tags: [...tags, 'kind=cf-zones'],
          stdinFilename: 'cloudflare-zones.json',
          stdinData: zones,
        });
        info(`cloudflare zones snapshot ${snap.shortId} (${humanBytes(snap.sizeBytes ?? 0)} added)`);
        snapCount++;
      } catch (e) {
        warn(`cloudflare zone export failed: ${(e as Error).message}`);
      }
    }
  }

  // apply retention. on an append-only backend (rest-server --append-only)
  // primary cannot prune by design — pruning runs locally on the backup vps
  // via its own cron, where admin-level access is gated separately. this
  // means an intruder on primary cannot wipe snapshots with retention=0.
  if (!dryRun) {
    if (isAppendOnly()) {
      info(`retention skipped (append-only backend; backup-vps handles prune locally)`);
    } else {
      prune(app, cfg.retention);
    }
  }

  success(`${prefix}${app}: ${snapCount} snapshot(s) ${dryRun ? 'planned' : 'added'}`);
}

function cmdSnapshotAll(args: string[]): void {
  const dryRun = args.includes('--dry-run');
  const apps = listConfiguredApps();
  if (apps.length === 0) {
    warn('no configured backups; run init-system or register-all first');
    return;
  }
  heading(`${dryRun ? '[dry-run] ' : ''}snapshotting ${apps.length} apps`);
  for (const app of apps) {
    try {
      cmdSnapshot([app, ...(dryRun ? ['--dry-run'] : [])]);
    } catch (e) {
      error(`${app}: ${(e as Error).message}`);
    }
  }
}

function cmdList(args: string[]): void {
  const [app] = args;
  validateAppName(app);
  const snaps = listSnapshots(app);
  if (snaps.length === 0) { info(`no snapshots for ${app}`); return; }
  heading(`snapshots for ${app}`);
  const rows = snaps.map(s => [
    s.shortId,
    s.time.replace('T', ' ').slice(0, 19),
    s.tags.join(','),
    s.paths.join(', ').slice(0, 80),
  ]);
  table(['id', 'time', 'tags', 'paths'], rows);
}

function cmdRestore(args: string[]): void {
  const positional = args.filter(a => !a.startsWith('--') && !isFlagValue(args, a));
  const [app, snapId] = positional;
  validateAppName(app);
  if (!snapId) throw new FleetError('snapshot id required');

  let target = '';
  const include: string[] = [];
  const dryRun = args.includes('--dry-run');
  const verify = args.includes('--verify');
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--to') { target = args[++i] ?? ''; continue; }
    if (args[i] === '--include') { include.push(args[++i] ?? ''); continue; }
  }
  if (!target) throw new FleetError(`--to <dir> required (we never restore in place automatically)`);
  if (!existsSync(target) && !dryRun) mkdirSync(target, { recursive: true });

  restore(app, { snapshotId: snapId, target, include, dryRun, verify });
  if (dryRun) {
    success(`[dry-run] would restore ${snapId} to ${target}`);
    return;
  }
  if (verify) {
    success(`restored + verified ${snapId} to ${target}`);
  } else {
    success(`restored ${snapId} to ${target}  (run with --verify to integrity-check)`);
  }
}

function isFlagValue(args: string[], current: string): boolean {
  const i = args.indexOf(current);
  return i > 0 && (args[i - 1] === '--to' || args[i - 1] === '--include');
}

function cmdPrune(args: string[]): void {
  const cfg = mustLoadConfig(args[0]);
  prune(cfg.app, cfg.retention);
  success(`retention applied for ${cfg.app}`);
}

function cmdVerify(args: string[]): void {
  const [app] = args;
  validateAppName(app);
  const ok = check(app);
  if (ok) { success(`verify ok: ${app}`); return; }
  error(`verify FAILED: ${app}`);
  process.exit(1);
}

function cmdSchedule(args: string[]): void {
  const dryRun = args.includes('--dry-run');
  const positional = args.filter(a => !a.startsWith('--'));
  const [app, schedule] = positional;
  const cfg = mustLoadConfig(app);
  if (!schedule) throw new FleetError('schedule required (hourly/daily/weekly)');
  cfg.schedule = schedule as typeof cfg.schedule;
  if (dryRun) {
    const plan = installScheduleUnits(cfg.app, cfg.schedule, { apply: false });
    heading(`[dry-run] would install timer for ${cfg.app}`);
    info(`timer: ${plan.timerPath}`);
    process.stdout.write(plan.timerContent);
    if (plan.sharedServiceWrote) {
      info(`+ first-time shared service: ${plan.sharedServicePath}`);
      process.stdout.write(plan.sharedServiceContent);
    }
    return;
  }
  saveConfig(cfg);
  installScheduleUnits(cfg.app, cfg.schedule, { apply: true });
  success(`schedule set: ${cfg.app} every ${schedule}`);
}

function cmdScheduleAll(args: string[]): void {
  const dryRun = args.includes('--dry-run');
  const apps = listConfiguredApps();
  if (apps.length === 0) { warn('no configured backups'); return; }
  heading(`${dryRun ? '[dry-run] ' : ''}scheduling ${apps.length} apps`);
  const rows: string[][] = [];
  for (const app of apps) {
    const cfg = loadConfig(app);
    if (!cfg) { rows.push([app, 'SKIP', 'no config']); continue; }
    try {
      if (!dryRun) installScheduleUnits(cfg.app, cfg.schedule, { apply: true });
      rows.push([app, dryRun ? 'plan' : 'enabled', `OnCalendar=${cfg.schedule}`]);
    } catch (e) {
      rows.push([app, 'FAIL', (e as Error).message]);
    }
  }
  table(['app', 'status', 'schedule'], rows);
}

function cmdUnschedule(args: string[]): void {
  const [app] = args;
  validateAppName(app);
  disableSchedule(app);
  success(`schedule disabled: ${app}`);
}

function cmdIntegrity(args: string[]): void {
  const positional = args.filter(a => !a.startsWith('--'));
  const [app] = positional;
  validateAppName(app);
  let pct = 5;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--read') pct = parseInt(args[++i] ?? '5', 10);
  }
  info(`integrity check ${app} (read ${pct}% of data; can take minutes for large repos)`);
  const r = checkIntegrity(app, pct);
  if (!r.ok) {
    error(`integrity FAILED for ${app}:\n${r.output}`);
    process.exit(1);
  }
  success(`integrity ok: ${app}`);
}

function cmdStatus(): void {
  const apps = listConfiguredApps();
  if (apps.length === 0) {
    info(`no configured backups. start with: fleet backup init-system`);
    return;
  }
  heading('fleet backups');
  const rows: string[][] = [];
  for (const app of apps) {
    const cfg = loadConfig(app);
    if (!cfg) continue;
    const snaps = listSnapshots(app);
    const last = snaps[snaps.length - 1];
    const st = stats(app);
    rows.push([
      cfg.disabled ? `${c.dim}${app}${c.reset}` : app,
      cfg.schedule,
      String(snaps.length),
      last ? last.time.replace('T', ' ').slice(0, 19) : '-',
      st ? humanBytes(st.totalSize) : '-',
    ]);
  }
  table(['app', 'schedule', 'snaps', 'last', 'size'], rows);
}

function cmdTest(args: string[]): void {
  const [app] = args;
  validateAppName(app);

  // 1. snapshot a tiny dummy payload
  const fakePath = join(tmpdir(), `fleet-backup-test-${process.pid}`);
  mkdirSync(fakePath, { recursive: true });
  const marker = `test ${Date.now()}`;
  execSafe('sh', ['-c', `echo "${marker}" > ${shellEscape(fakePath)}/hello.txt`], { timeout: 2_000 });

  const snap = snapshot(app, { paths: [fakePath], tags: ['kind=e2e-test'] });
  info(`snapshot ${snap.shortId}`);

  // 2. restore to a fresh tmp dir
  const restoreDir = `${fakePath}-restore`;
  mkdirSync(restoreDir, { recursive: true });
  restore(app, { snapshotId: snap.shortId, target: restoreDir });

  // 3. read back the marker
  const r = execSafe('cat', [join(restoreDir, fakePath, 'hello.txt')], { timeout: 2_000 });
  rmSync(fakePath, { recursive: true, force: true });
  rmSync(restoreDir, { recursive: true, force: true });

  if (r.stdout.trim() !== marker) {
    error(`marker mismatch: ${r.stdout}`);
    process.exit(1);
  }
  success(`e2e test passed for ${app}`);
}

function mustLoadConfig(app: string) {
  validateAppName(app);
  const cfg = loadConfig(app);
  if (!cfg) throw new FleetError(`no config for ${app}; run: fleet backup register ${app}  (or init-system for pseudo-apps)`);
  return cfg;
}

function humanBytes(n: number): string {
  if (n < 1024) return `${n}B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)}K`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)}M`;
  return `${(n / 1024 ** 3).toFixed(2)}G`;
}

function shellEscape(s: string): string {
  return `'${s.replace(/'/g, "'\\''")}'`;
}
