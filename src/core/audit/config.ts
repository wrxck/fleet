import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { readJson, writeJsonAtomic } from '../fs-json';
import type { AuditConfig } from './types';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_CONFIG_PATH = join(__dirname, '..', '..', '..', 'data', 'audit-config.json');

export function defaultAuditConfig(): AuditConfig {
  return { version: 1, ignore: [] };
}

// load the audit config (ignore rules). a missing or corrupt file yields the
// default empty config — a bad config must never abort an audit.
export function loadAuditConfig(path: string = DEFAULT_CONFIG_PATH): AuditConfig {
  const parsed = readJson<AuditConfig>(path);
  if (!parsed || !Array.isArray(parsed.ignore)) return defaultAuditConfig();
  return { version: 1, ignore: parsed.ignore };
}

// persist the audit config via an atomic tmp-file rename.
export function saveAuditConfig(config: AuditConfig, path: string = DEFAULT_CONFIG_PATH): void {
  writeJsonAtomic(path, config);
}

export function auditConfigPath(): string {
  return DEFAULT_CONFIG_PATH;
}
