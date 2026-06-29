import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { readJson, writeJsonAtomic } from '../fs-json';
import type { DepsCache } from './types';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_CACHE_PATH = join(__dirname, '..', '..', '..', 'data', 'deps-cache.json');

export function loadCache(path: string = DEFAULT_CACHE_PATH): DepsCache | null {
  // a missing OR corrupt cache yields null, which callers treat as "no cache"
  // and re-scan — a torn cache file must never crash the deps scanner.
  return readJson<DepsCache>(path);
}

export function saveCache(cache: DepsCache, path: string = DEFAULT_CACHE_PATH): void {
  writeJsonAtomic(path, cache);
}

export function isCacheStale(cache: DepsCache | null, intervalHours: number): boolean {
  if (!cache) return true;
  const age = Date.now() - new Date(cache.lastScan).getTime();
  return age > intervalHours * 60 * 60 * 1000;
}

export function cachePath(): string {
  return DEFAULT_CACHE_PATH;
}
