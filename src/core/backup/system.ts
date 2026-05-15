import { DEFAULT_RETENTION } from './config';
import { AppBackupConfig } from './types';

/** the `system` pseudo-app: os, infra config, all the things needed to rebuild
 * this host from a fresh ubuntu install + the data on the backup vps. */
export const SYSTEM_PATHS = [
  '/etc/nginx',
  '/etc/letsencrypt',
  '/etc/systemd/system',
  '/etc/systemd/resolved.conf.d',
  '/etc/fleet',
  '/etc/iptables',
  '/etc/truewaf',
  '/etc/modsecurity',
  '/etc/ssh',
  '/etc/sudoers',
  '/etc/sudoers.d',
  '/etc/fail2ban',
  '/etc/cron.d',
  '/etc/crontab',
  '/etc/netplan',
  '/etc/hosts',
  '/etc/hostname',
  '/etc/timezone',
  '/etc/apt/sources.list',
  '/etc/apt/sources.list.d',
  '/etc/apt/keyrings',
  '/etc/sysctl.conf',
  '/etc/sysctl.d',
  '/etc/security',
  '/etc/php',
  '/etc/guardian',
  '/etc/cloud',
  '/etc/default',
  '/etc/ntpsec',
  '/etc/logrotate.d',
  '/etc/docker/daemon.json',
  '/etc/nftables.conf',
  '/var/lib/fleet',
  '/var/lib/letsencrypt',
  '/var/lib/fail2ban',
  '/usr/local/bin',
  '/usr/local/sbin',
  '/opt/coreruleset',
  '/root/firewall',
];

export const ROOT_HOME_PATHS = [
  '/root/.ssh',
  '/root/.docker/config.json',
  '/root/.docker/.token_seed',
  '/root/.secrets',
  '/root/.gnupg',
  '/root/.aws',
  '/root/.gcloud',
  '/root/.azure',
  '/root/.kube',
  '/root/.gitconfig',
  '/root/.npmrc',
  '/root/.bashrc',
  '/root/.bash_profile',
  '/root/.bash_history',
  '/root/.claude',
  '/root/.claude.json',
  '/root/.mcp.json',
  '/root/.gmail-mcp/tokens',
  '/root/.cargo/credentials.toml',
  '/root/.cargo/config.toml',
  '/root/.pm2/dump.pm2',
  '/root/.pm2/module_conf.json',
];

/** excludes for root-home and matt-home: claude code regeneratable state
 *  (sessions, plugin caches, telemetry) and tool caches that take GBs but
 *  contain nothing the user authored. credentials.json, settings, hooks,
 *  skills, plans, mcp.json all stay. */
export const HOME_EXCLUDES = [
  '**/.claude/projects',
  '**/.claude/plugins/data',
  '**/.claude/plugins/cache',
  '**/.claude/plugins/marketplaces',
  '**/.claude/plugins/install-counts-cache.json',
  '**/.claude/file-history',
  '**/.claude/paste-cache',
  '**/.claude/telemetry',
  '**/.claude/todos',
  '**/.claude/tasks',
  '**/.claude/backups',
  '**/.claude/session-env',
  '**/.claude/sessions',
  '**/.claude/cache',
  '**/.claude/debug',
  '**/.claude/shell-snapshots',
  '**/.claude/usage-data',
  '**/.claude/cc-counter',
  '**/.claude/statsig',
  '**/.claude/stats-cache.json',
  '**/.claude/history.jsonl',
  '**/.claude/ide',
  '**/.claude/downloads',
  '**/.claude/mcp-needs-auth-cache.json',
  '**/.claude/.last-cleanup',
  '**/.claude/hooks/.last_test_run_*',
  '*.log',
];

export const MATT_HOME_PATHS = [
  '/home/matt/.ssh',
  '/home/matt/.gitconfig',
  '/home/matt/.docker/config.json',
  '/home/matt/.config/gh',
  '/home/matt/.config/op',
  '/home/matt/.aws',
  '/home/matt/.gnupg',
  '/home/matt/.terraform.d',
  '/home/matt/.claude',
  '/home/matt/.claude.json',
  '/home/matt/.mcp.json',
  '/home/matt/.bashrc',
  '/home/matt/.bash_history',
  '/home/matt/.profile',
  '/home/matt/.local/bin',
];

export const MATT_HOME_EXCLUDES = [
  ...HOME_EXCLUDES,
  '*.cache',
  '.npm',
  '.yarn',
  '.cargo/registry',
  '.cargo/git',
  '.gradle/caches',
  '.local/share',
  'node_modules',
];

export function systemConfig(): AppBackupConfig {
  return {
    app: 'system',
    schedule: 'daily',
    paths: SYSTEM_PATHS,
    exclude: ['*.log', '*.pid', '.cache'],
    retention: DEFAULT_RETENTION,
  };
}

export function rootHomeConfig(): AppBackupConfig {
  return {
    app: 'root-home',
    schedule: 'daily',
    paths: ROOT_HOME_PATHS,
    exclude: HOME_EXCLUDES,
    retention: DEFAULT_RETENTION,
  };
}

/** shared-cluster dumps. these are safety nets — they capture every database
 *  in the shared container as one big stream. per-app preDump entries are
 *  preferred for routine restore granularity (run hourly), but these run
 *  daily and catch DBs the per-app list doesn't enumerate. */
export function sharedPostgresConfig(): AppBackupConfig {
  return {
    app: 'shared-postgres',
    schedule: 'daily',
    paths: [],
    exclude: [],
    // postgres_user=postgres is set in compose env; pg_dumpall uses unix-socket
    // peer auth so no password needed inside the container.
    preDump: { type: 'postgres', container: 'shared-postgres', user: 'postgres' },
    retention: { daily: 14, weekly: 8, monthly: 12 },
  };
}

export function sharedMysqlConfig(): AppBackupConfig {
  return {
    app: 'shared-mysql',
    schedule: 'daily',
    paths: [],
    exclude: [],
    // shared-mysql uses docker secrets — password lives at the file path below,
    // not in an env var.
    preDump: {
      type: 'mysql',
      container: 'shared-mysql',
      user: 'root',
      passwordFile: '/run/secrets/mysql_root_password',
    },
    retention: { daily: 14, weekly: 8, monthly: 12 },
  };
}

export function sharedMongoConfig(): AppBackupConfig {
  return {
    app: 'shared-mongodb',
    schedule: 'daily',
    paths: [],
    exclude: [],
    preDump: {
      type: 'mongo',
      container: 'shared-mongodb',
      user: 'root',
      passwordFile: '/run/secrets/mongo_root_password',
    },
    retention: { daily: 14, weekly: 8, monthly: 12 },
  };
}

export function mattHomeConfig(): AppBackupConfig {
  return {
    app: 'matt-home',
    schedule: 'daily',
    paths: MATT_HOME_PATHS,
    exclude: MATT_HOME_EXCLUDES,
    retention: DEFAULT_RETENTION,
  };
}
