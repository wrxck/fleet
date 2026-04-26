import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { error, info, success } from '../ui/output.js';

// scripts that ship inside the npm package (under scripts/guard/) and get
// installed to /usr/local/sbin during `fleet guard install`.
type Script = {
  name: string;       // filename in scripts/guard/ and target name in /usr/local/sbin
  mode: number;       // unix mode for the installed copy
  group?: string;     // chgrp target (optional)
};

const SCRIPTS: readonly Script[] = [
  { name: 'notify',             mode: 0o700 },
  { name: 'fleet-guard',        mode: 0o750, group: 'fleet-guard' },
  { name: 'fleet-guard-execute', mode: 0o750, group: 'fleet-guard' },
  { name: 'cf-audit-monitor',   mode: 0o700 },
  { name: 'cf-snapshot',        mode: 0o700 },
  { name: 'dns-drift-watch',    mode: 0o750, group: 'fleet-guard' },
  { name: 'cert-expiry-watch',  mode: 0o750, group: 'fleet-guard' },
];

const TARGET_BIN = '/usr/local/sbin';
const STATE_DIR = '/var/lib/fleet-guard';
const LOG_DIR = '/var/log/fleet-guard';
const SNAP_DIR = '/var/lib/cf-snapshots';
const CRON_TARGET = '/etc/cron.d/cf-protect';
const LOGROTATE_TARGET = '/etc/logrotate.d/fleet-guard';

function scriptsDir(): string {
  // dist/commands/guard.js -> ../../scripts/guard relative to compiled file
  const here = dirname(fileURLToPath(import.meta.url));
  return join(here, '..', '..', 'scripts', 'guard');
}

function requireRoot(): void {
  if (process.getuid && process.getuid() !== 0) {
    throw new Error('this command needs root. try: sudo fleet guard install');
  }
}

function run(cmd: string, args: string[]): void {
  const r = spawnSync(cmd, args, { stdio: 'inherit' });
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(' ')} failed`);
}

function ensureUser(): void {
  const r = spawnSync('id', ['fleet-guard'], { stdio: 'ignore' });
  if (r.status === 0) return;
  run('useradd', ['--system', '--no-create-home', '--shell', '/usr/sbin/nologin', 'fleet-guard']);
  info('created system user fleet-guard');
}

function ensureDir(path: string, mode: number, group?: string): void {
  if (!existsSync(path)) mkdirSync(path, { recursive: true });
  chmodSync(path, mode);
  if (group) run('chgrp', ['-R', group, path]);
}

function installScripts(): void {
  const src = scriptsDir();
  if (!existsSync(src)) {
    throw new Error(`scripts not bundled at ${src} — broken install`);
  }
  for (const s of SCRIPTS) {
    const from = join(src, s.name);
    const to = join(TARGET_BIN, s.name);
    if (!existsSync(from)) throw new Error(`missing bundled script: ${from}`);
    copyFileSync(from, to);
    chmodSync(to, s.mode);
    if (s.group) run('chown', [`root:${s.group}`, to]);
    info(`installed ${to}`);
  }
}

function installCron(): void {
  const cron = `# fleet guard — auto-installed, edit with care
SHELL=/bin/bash
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin

*/15 * * * * root /usr/local/sbin/cf-audit-monitor >> /var/log/cf-audit-monitor.log 2>&1
*/30 * * * * root /usr/local/sbin/cf-snapshot >> /var/log/cf-snapshot.log 2>&1
*/30 * * * * root /usr/local/sbin/dns-drift-watch >> /var/log/dns-drift-watch.log 2>&1
17 4 * * * root /usr/local/sbin/cert-expiry-watch >> /var/log/cert-expiry-watch.log 2>&1
* * * * * fleet-guard /usr/local/sbin/fleet-guard execute >> /var/log/fleet-guard/execute.log 2>&1
`;
  writeFileSync(CRON_TARGET, cron, { mode: 0o644 });
  info(`installed cron at ${CRON_TARGET}`);
}

function installLogrotate(): void {
  const src = join(scriptsDir(), 'logrotate.d-fleet-guard');
  if (!existsSync(src)) {
    info('logrotate template missing, skipping');
    return;
  }
  copyFileSync(src, LOGROTATE_TARGET);
  chmodSync(LOGROTATE_TARGET, 0o644);
  info(`installed logrotate at ${LOGROTATE_TARGET}`);
}

function installCommand(): void {
  requireRoot();
  ensureUser();
  ensureDir(STATE_DIR, 0o700, 'fleet-guard');
  ensureDir(join(STATE_DIR, 'pending'), 0o700, 'fleet-guard');
  ensureDir(join(STATE_DIR, 'approved'), 0o700, 'fleet-guard');
  ensureDir(join(STATE_DIR, 'processed'), 0o700, 'fleet-guard');
  ensureDir(LOG_DIR, 0o700, 'fleet-guard');
  ensureDir(SNAP_DIR, 0o700);
  installScripts();
  installCron();
  installLogrotate();
  success('fleet guard installed.');
  info('next steps:');
  info('  1. seed creds at /etc/fleet/guard.cf.json (cloudflare api key + email + accountId)');
  info('  2. ensure /etc/fleet/notify.json has telegram and/or bluebubbles adapters');
  info('  3. add /approve, /reject, /guard commands to fleet-bot (PR #60 in fleet repo)');
}

function delegate(verb: string, args: string[]): number {
  // every other verb just shells out to the host /usr/local/sbin/fleet-guard cli
  // so we have a single source of truth for the queue logic.
  const r = spawnSync('/usr/local/sbin/fleet-guard', [verb, ...args], { stdio: 'inherit' });
  return r.status ?? 1;
}

function helpText(): string {
  return [
    'fleet guard <subcommand>',
    '',
    'subcommands:',
    '  install                            install scripts, user, cron, dirs (root)',
    '  status                             show queue counts + pending tokens',
    '  list [pending|approved|processed]  list records',
    '  hold <kind> <summary> [--payload]  create a pending action',
    '  approve <token>                    approve a pending action',
    '  reject <token>                     reject a pending action',
    '  show <token>                       dump one record',
    '  execute                            run all approved actions',
  ].join('\n');
}

export function guardCommand(args: string[]): void {
  const [sub, ...rest] = args;

  if (!sub || sub === 'help' || sub === '--help' || sub === '-h') {
    info(helpText());
    return;
  }

  if (sub === 'install') {
    try {
      installCommand();
    } catch (e: unknown) {
      error((e as Error).message);
      process.exit(1);
    }
    return;
  }

  const passthrough = new Set(['status', 'list', 'hold', 'approve', 'reject', 'show', 'execute']);
  if (passthrough.has(sub)) {
    const code = delegate(sub, rest);
    if (code !== 0) process.exit(code);
    return;
  }

  error(`unknown subcommand: ${sub}`);
  console.log(helpText());
  process.exit(2);
}
