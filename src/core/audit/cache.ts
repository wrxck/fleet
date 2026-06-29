import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { readJson, writeJsonAtomic } from '../fs-json';

import type { AuditCache, AuditRecord } from './types';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_CACHE_PATH = join(__dirname, '..', '..', '..', 'data', 'audit-cache.json');

function emptyCache(): AuditCache {
  return { version: 1, audits: {} };
}

// load the audit cache, returning an empty cache when the file is absent or
// unreadable — a stale/corrupt cache must never block a fresh audit.
export function loadAuditCache(path: string = DEFAULT_CACHE_PATH): AuditCache {
  const parsed = readJson<AuditCache>(path);
  if (!parsed || typeof parsed !== 'object' || !parsed.audits) return emptyCache();
  return parsed;
}

// upsert one audit record, keyed by target, via an atomic tmp-file rename.
export function saveAuditRecord(record: AuditRecord, path: string = DEFAULT_CACHE_PATH): void {
  const cache = loadAuditCache(path);
  cache.audits[record.target] = record;
  writeJsonAtomic(path, cache);
}

export function auditCachePath(): string {
  return DEFAULT_CACHE_PATH;
}
