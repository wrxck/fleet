import { readFileSync, writeFileSync, renameSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { AuditConfig } from './types';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_CONFIG_PATH = join(__dirname, '..', '..', '..', 'data', 'audit-config.json');

export function defaultAuditConfig(): AuditConfig {
  return { version: 1, ignore: [] };
}

// load the audit config (ignore rules). a missing or corrupt file yields the
// default empty config — a bad config must never abort an audit.
export function loadAuditConfig(path: string = DEFAULT_CONFIG_PATH): AuditConfig {
  if (!existsSync(path)) return defaultAuditConfig();
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf-8')) as AuditConfig;
    if (!parsed || !Array.isArray(parsed.ignore)) return defaultAuditConfig();
    return { version: 1, ignore: parsed.ignore };
  } catch {
    return defaultAuditConfig();
  }
}

// persist the audit config via an atomic tmp-file rename.
export function saveAuditConfig(config: AuditConfig, path: string = DEFAULT_CONFIG_PATH): void {
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const tmp = path + '.tmp';
  writeFileSync(tmp, JSON.stringify(config, null, 2) + '\n');
  renameSync(tmp, path);
}

export function auditConfigPath(): string {
  return DEFAULT_CONFIG_PATH;
}
