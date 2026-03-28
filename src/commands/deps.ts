import { writeFileSync, chmodSync } from 'node:fs';

import { load, findApp } from '../core/registry.js';
import { loadConfig, saveConfig, defaultConfig, configPath } from '../core/deps/config.js';
import { loadCache, saveCache, isCacheStale, cachePath } from '../core/deps/cache.js';
import { runScan } from '../core/deps/scanner.js';
import { formatSummary, formatAppDetail } from '../core/deps/reporters/cli.js';
import { formatMotd, generateMotdScript } from '../core/deps/reporters/motd.js';
import {
  sendTelegramNotification, loadNotifiedFindings, saveNotifiedFindings,
} from '../core/deps/reporters/telegram.js';
import { createDepsPr } from '../core/deps/actors/pr-creator.js';
import { AppNotFoundError } from '../core/errors.js';
import { heading, success, error, info, warn } from '../ui/output.js';

export async function depsCommand(args: string[]): Promise<void> {
  const sub = args[0];

  switch (sub) {
    case 'scan': return depsScan(args.slice(1));
    case 'fix': return depsFix(args.slice(1));
    case 'config': return depsConfig(args.slice(1));
    case 'ignore': return depsIgnore(args.slice(1));
    case 'unignore': return depsUnignore(args.slice(1));
    case 'init': return depsInit();
    default: return depsShow(args);
  }
}

async function depsShow(args: string[]): Promise<void> {
  const json = args.includes('--json');
  const motd = args.includes('--motd');
  const severityFilter = extractFlag(args, '--severity');
  const appName = args.find(a => !a.startsWith('-'));

  const config = loadConfig();
  const cache = loadCache();
  const reg = load();

  if (!cache) {
    warn('No scan data found. Run: fleet deps scan');
    return;
  }

  if (isCacheStale(cache, config.scanIntervalHours)) {
    warn(`Scan data is stale (last scan: ${cache.lastScan}). Run: fleet deps scan`);
  }

  if (json) {
    if (appName) {
      const findings = cache.findings.filter(f => f.appName === appName);
      process.stdout.write(JSON.stringify(findings, null, 2) + '\n');
    } else {
      process.stdout.write(JSON.stringify(cache, null, 2) + '\n');
    }
    return;
  }

  if (motd) {
    process.stdout.write(formatMotd(cache, reg.apps.length) + '\n');
    return;
  }

  if (appName) {
    const app = findApp(reg, appName);
    if (!app) throw new AppNotFoundError(appName);

    let findings = cache.findings.filter(f => f.appName === app.name);
    if (severityFilter) {
      const sevs = severityFilter.split(',');
      findings = findings.filter(f => sevs.includes(f.severity));
    }

    heading(`Deps: ${app.name}`);
    const lines = formatAppDetail(app.name, findings);
    for (const line of lines) process.stdout.write(line + '\n');
    process.stdout.write('\n');
    return;
  }

  heading('Dependency Health');
  let findings = cache.findings;
  if (severityFilter) {
    const sevs = severityFilter.split(',');
    findings = findings.filter(f => sevs.includes(f.severity));
  }

  const summaryCache = { ...cache, findings };
  const lines = formatSummary(summaryCache, reg.apps.length);
  for (const line of lines) process.stdout.write(line + '\n');
  process.stdout.write('\n');
}

async function depsScan(args: string[]): Promise<void> {
  const quiet = args.includes('--quiet');
  const reg = load();
  const config = loadConfig();

  if (!quiet) info('Scanning dependencies across all apps...');

  const cache = await runScan(reg.apps, config);
  saveCache(cache);

  if (config.notifications.telegram.enabled) {
    const previousFindings = loadNotifiedFindings();
    const sent = await sendTelegramNotification(
      cache.findings, reg.apps.length, previousFindings,
      config.notifications.telegram.minSeverity,
    );
    if (sent) {
      saveNotifiedFindings(cache.findings);
      if (!quiet) info('Telegram notification sent');
    }
  }

  if (!quiet) {
    success(`Scan complete: ${cache.findings.length} findings across ${reg.apps.length} apps (${cache.scanDurationMs}ms)`);
    if (cache.errors.length > 0) {
      warn(`${cache.errors.length} collector errors`);
    }
    process.stdout.write('\n');

    heading('Dependency Health');
    const lines = formatSummary(cache, reg.apps.length);
    for (const line of lines) process.stdout.write(line + '\n');
    process.stdout.write('\n');
  }
}

async function depsFix(args: string[]): Promise<void> {
  const dryRun = args.includes('--dry-run');
  const appName = args.find(a => !a.startsWith('-'));

  if (!appName) {
    error('Usage: fleet deps fix <app> [--dry-run] [--major]');
    process.exit(1);
  }

  const reg = load();
  const app = findApp(reg, appName);
  if (!app) throw new AppNotFoundError(appName);

  const cache = loadCache();
  if (!cache) {
    error('No scan data. Run: fleet deps scan');
    process.exit(1);
  }

  const findings = cache.findings.filter(f => f.appName === app.name && f.fixable);

  if (findings.length === 0) {
    info('No fixable findings for this app');
    return;
  }

  const result = createDepsPr(app, findings, dryRun);

  if (dryRun) {
    heading(`Dry run: ${app.name}`);
    info(`Would create branch: ${result.branch}`);
    for (const bump of result.bumps) {
      info(`  ${bump.file}: ${bump.search} -> ${bump.replace}`);
    }
    return;
  }

  if (result.prUrl) {
    success(`PR created: ${result.prUrl}`);
  } else {
    success(`Branch ${result.branch} pushed with ${result.bumps.length} updates`);
  }
}

async function depsConfig(args: string[]): Promise<void> {
  const config = loadConfig();

  if (args.length === 0) {
    process.stdout.write(JSON.stringify(config, null, 2) + '\n');
    return;
  }

  if (args[0] === 'set' && args.length >= 3) {
    const key = args[1];
    const value = args[2];
    const parsed = value === 'true' ? true : value === 'false' ? false : isNaN(Number(value)) ? value : Number(value);
    (config as unknown as Record<string, unknown>)[key] = parsed;
    saveConfig(config);
    success(`Set ${key} = ${value}`);
    return;
  }

  error('Usage: fleet deps config [set <key> <value>]');
}

async function depsIgnore(args: string[]): Promise<void> {
  const pkg = args.find(a => !a.startsWith('-'));
  const appName = extractFlag(args, '--app');
  const reason = extractFlag(args, '--reason');
  const until = extractFlag(args, '--until');

  if (!pkg || !reason) {
    error('Usage: fleet deps ignore <package> --reason "..." [--app <name>] [--until YYYY-MM-DD]');
    process.exit(1);
  }

  const config = loadConfig();
  config.ignore.push({
    package: pkg,
    ...(appName && { appName }),
    reason,
    ...(until && { until }),
  });
  saveConfig(config);
  success(`Ignoring ${pkg}${appName ? ` for ${appName}` : ''}: ${reason}`);
}

async function depsUnignore(args: string[]): Promise<void> {
  const pkg = args.find(a => !a.startsWith('-'));
  const appName = extractFlag(args, '--app');

  if (!pkg) {
    error('Usage: fleet deps unignore <package> [--app <name>]');
    process.exit(1);
  }

  const config = loadConfig();
  config.ignore = config.ignore.filter(r => {
    if (r.package !== pkg) return true;
    if (appName && r.appName !== appName) return true;
    return false;
  });
  saveConfig(config);
  success(`Removed ignore rule for ${pkg}`);
}

async function depsInit(): Promise<void> {
  const config = loadConfig();
  saveConfig(config);
  success(`Config written to ${configPath()}`);

  const motdPath = '/etc/update-motd.d/99-fleet-deps';
  const script = generateMotdScript(cachePath());
  writeFileSync(motdPath, script);
  chmodSync(motdPath, 0o755);
  success(`MOTD script installed at ${motdPath}`);

  const cronLine = `0 */${config.scanIntervalHours} * * * root /usr/local/bin/fleet deps scan --quiet\n`;
  writeFileSync('/etc/cron.d/fleet-deps', cronLine);
  success(`Cron installed: every ${config.scanIntervalHours} hours`);

  info('Running initial scan...');
  await depsScan(['--quiet']);
  success('Initial scan complete. Run: fleet deps');
}

function extractFlag(args: string[], flag: string): string | undefined {
  const idx = args.indexOf(flag);
  if (idx === -1 || idx + 1 >= args.length) return undefined;
  return args[idx + 1];
}
