import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { FleetError } from '../errors';

import { AppBackupConfig, Retention, isPseudoApp } from './types';

// read at call time so test env overrides land. consumers that want the
// resolved path should call backupConfigDir() / backupVaultDir().
export function backupConfigDir(): string {
  return process.env.FLEET_BACKUP_CONFIG_DIR ?? '/etc/fleet/backups';
}
export function backupVaultDir(): string {
  return process.env.FLEET_BACKUP_VAULT_DIR ?? '/etc/fleet/restic-vault';
}

export const DEFAULT_RETENTION: Retention = {
  hourly: 24,
  daily: 14,
  weekly: 8,
  monthly: 12,
};

export const DEFAULT_EXCLUDES = [
  'node_modules',
  '.next',
  'dist',
  'build',
  'target',
  '__pycache__',
  '.cache',
  '.venv',
  'venv',
  '.npm',
  '.yarn',
  'coverage',
  '.pytest_cache',
  '*.log',
  '*.pid',
  '*.lock',
  '.DS_Store',
  'tmp',
];

function configPath(app: string): string {
  return join(backupConfigDir(), `${app}.json`);
}

export function loadConfig(app: string): AppBackupConfig | null {
  const path = configPath(app);
  if (!existsSync(path)) return null;
  const raw = JSON.parse(readFileSync(path, 'utf-8'));
  // basic shape check
  if (!raw.app || !Array.isArray(raw.paths) || !raw.retention) {
    throw new FleetError(`malformed backup config at ${path}`);
  }
  return raw as AppBackupConfig;
}

export function saveConfig(cfg: AppBackupConfig): void {
  const dir = backupConfigDir();
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
  writeFileSync(configPath(cfg.app), JSON.stringify(cfg, null, 2) + '\n', { mode: 0o600 });
}

export function listConfiguredApps(): string[] {
  const dir = backupConfigDir();
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter(f => f.endsWith('.json'))
    .map(f => f.slice(0, -5))
    .sort();
}

export function validateAppName(app: string): void {
  if (!app) throw new FleetError('app name required');
  if (isPseudoApp(app)) return;
  if (!/^[a-z0-9_][a-z0-9._-]{0,62}$/.test(app)) {
    throw new FleetError(`invalid app name: ${app}`);
  }
}
