import { load, findApp } from '../core/registry.js';
import { getContainerLogs } from '../core/docker.js';
import { execLive } from '../core/exec.js';
import { AppNotFoundError } from '../core/errors.js';
import { c, error, heading, info, success, table, warn } from '../ui/output.js';
import { confirm } from '../ui/confirm.js';
import { prompt } from '../ui/prompt.js';
import {
  effectivePolicy,
  writeComposeOverride,
  getLogStatus,
  pruneLogs,
  readContainerLogs,
  type LogPolicy,
} from '../core/logs-policy.js';

export function logsCommand(args: string[]): void | Promise<void> {
  const sub = args[0];
  if (sub === 'setup') return logsSetup(args.slice(1));
  if (sub === 'status') return logsStatus(args.slice(1));
  if (sub === 'prune') return logsPrune(args.slice(1));
  // Default: tail / follow — synchronous so existing test expectations and
  // process.exit semantics work unchanged.
  return logsTail(args);
}

function logsTail(args: string[]): void {
  const follow = args.includes('-f') || args.includes('--follow');

  const nIdx = args.indexOf('-n');
  const lines = nIdx >= 0 ? parseInt(args[nIdx + 1], 10) || 100 : 100;

  const cIdx = args.indexOf('-c');
  const containerArg = cIdx >= 0 ? args[cIdx + 1] : undefined;

  const sinceIdx = args.indexOf('--since');
  const since = sinceIdx >= 0 ? args[sinceIdx + 1] : undefined;

  const grepIdx = args.indexOf('--grep');
  const grep = grepIdx >= 0 ? args[grepIdx + 1] : undefined;

  const levelIdx = args.indexOf('--level');
  const level = levelIdx >= 0 ? args[levelIdx + 1] as LogPolicy['level'] : undefined;

  const skipIndices = new Set<number>();
  for (const i of [nIdx, cIdx, sinceIdx, grepIdx, levelIdx]) {
    if (i >= 0) { skipIndices.add(i); skipIndices.add(i + 1); }
  }
  const appName = args.find((a, i) => !a.startsWith('-') && !skipIndices.has(i));

  if (!appName) {
    error('Usage: fleet logs <app> [-f] [-n <lines>] [-c <container>]');
    error('       Subcommands: setup [--all] | status [<app>] | prune <app>');
    error('       Tail filters: --since <Nm|Nh> | --grep <text> | --level info|warn|error');
    process.exit(1);
  }

  const reg = load();
  const app = findApp(reg, appName);
  if (!app) throw new AppNotFoundError(appName);

  if (app.containers.length === 0) {
    error(`No containers registered for ${app.name}`);
    process.exit(1);
  }

  let container = containerArg ?? app.containers[0];
  if (containerArg && !app.containers.includes(containerArg)) {
    error(`Container "${containerArg}" not found in ${app.name}. Available:`);
    for (const ct of app.containers) process.stderr.write(`  - ${ct}\n`);
    process.exit(1);
  }

  if (follow) {
    // For follow mode we delegate to native docker — filtering would buffer.
    const dockerArgs = ['logs', '-f', '--tail', lines.toString()];
    if (since) dockerArgs.push('--since', since);
    dockerArgs.push(container);
    const code = execLive('docker', dockerArgs);
    process.exit(code);
  }

  // Non-follow: use the policy-aware reader so --level / --grep / size cap apply.
  if (since || grep || level) {
    const sinceMinutes = since ? parseSinceMinutes(since) : undefined;
    const result = readContainerLogs(container, { lines, level, sinceMinutes, grep });
    process.stdout.write(result.text + '\n');
    if (result.truncated) {
      warn('Output truncated at 200KB. Narrow with --since/--grep/--level/-n.');
    }
    return;
  }

  // Plain tail: existing fast path.
  const output = getContainerLogs(container, lines);
  process.stdout.write(output + '\n');
}

function parseSinceMinutes(s: string): number {
  const m = s.match(/^(\d+)([mhd])?$/);
  if (!m) return 60;
  const n = parseInt(m[1], 10);
  const unit = m[2] ?? 'm';
  return unit === 'h' ? n * 60 : unit === 'd' ? n * 1440 : n;
}

async function logsSetup(args: string[]): Promise<void> {
  const all = args.includes('--all');
  const yes = args.includes('-y') || args.includes('--yes');
  const reg = load();
  const apps = all ? reg.apps : (() => {
    const name = args.find(a => !a.startsWith('-'));
    if (!name) {
      error('Usage: fleet logs setup <app>  OR  fleet logs setup --all');
      process.exit(1);
    }
    const a = findApp(reg, name);
    if (!a) throw new AppNotFoundError(name);
    return [a];
  })();

  let policy: LogPolicy;
  if (all || yes) {
    policy = { retentionDays: 7, maxSizeMB: 100, level: 'info' };
    info(`Applying default policy: ${policy.maxSizeMB}MB / ${policy.retentionDays}d / ${policy.level}`);
  } else {
    const ret = await prompt('Retention days', '7');
    const size = await prompt('Max size MB per container', '100');
    const lvl = await prompt('Min level (debug|info|warn|error)', 'info');
    policy = {
      retentionDays: parseInt(ret, 10) || 7,
      maxSizeMB: parseInt(size, 10) || 100,
      level: (lvl as LogPolicy['level']) ?? 'info',
    };
  }

  for (const app of apps) {
    const path = writeComposeOverride(app, policy);
    success(`${app.name}: wrote ${path}`);
  }
  info('To activate: include the override in your compose start command,');
  info('  e.g. `docker compose -f docker-compose.yml -f .fleet/logging.override.yml up -d`');
  info('Or have fleet patch the systemd unit (see: fleet patch-systemd).');
}

function logsStatus(args: string[]): void {
  const json = args.includes('--json');
  const appName = args.find(a => !a.startsWith('-'));
  const reg = load();
  const apps = appName ? [findApp(reg, appName)].filter(Boolean) as ReturnType<typeof findApp>[] : reg.apps;

  const rows: string[][] = [];
  const data: Array<Record<string, unknown>> = [];

  for (const app of apps) {
    if (!app) continue;
    const policy = effectivePolicy(app);
    const status = getLogStatus(app);
    for (const s of status) {
      data.push({ ...s, policy });
      const sizeStr = s.totalBytes != null ? `${(s.totalBytes / 1024 / 1024).toFixed(1)}M` : '?';
      const policyStr = `${policy.maxSizeMB}M/${policy.retentionDays}d/${policy.level}`;
      const ind = s.policyApplied ? `${c.green}*${c.reset}` : `${c.yellow}!${c.reset}`;
      rows.push([app.name, s.container, s.driver, sizeStr, policyStr, ind]);
    }
  }

  if (json) {
    process.stdout.write(JSON.stringify(data, null, 2) + '\n');
    return;
  }

  heading(`Log status (${rows.length} containers)`);
  table(['APP', 'CONTAINER', 'DRIVER', 'SIZE', 'POLICY', 'CONFIGURED'], rows);
  process.stdout.write('\n');
  info('* = override file present, ! = using docker defaults (unbounded by default)');
}

async function logsPrune(args: string[]): Promise<void> {
  const yes = args.includes('-y') || args.includes('--yes');
  const appName = args.find(a => !a.startsWith('-'));
  if (!appName) {
    error('Usage: fleet logs prune <app>');
    process.exit(1);
  }
  const reg = load();
  const app = findApp(reg, appName);
  if (!app) throw new AppNotFoundError(appName);

  const policy = effectivePolicy(app);
  warn(`Will vacuum journald to ${policy.retentionDays}d and truncate any json-file logs > 5x the policy max.`);
  if (!yes && !await confirm('Proceed?', false)) {
    info('Cancelled');
    return;
  }
  const freed = pruneLogs(app, policy);
  success(`Freed approximately ${(freed / 1024 / 1024).toFixed(1)}MB from json-file logs (journald vacuum applied separately).`);
}
