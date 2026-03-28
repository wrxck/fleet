import { readFileSync, writeFileSync, renameSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { DepsCache } from './types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_CACHE_PATH = join(__dirname, '..', '..', '..', 'data', 'deps-cache.json');

export function loadCache(path: string = DEFAULT_CACHE_PATH): DepsCache | null {
  if (!existsSync(path)) return null;
  const raw = readFileSync(path, 'utf-8');
  return JSON.parse(raw) as DepsCache;
}

export function saveCache(cache: DepsCache, path: string = DEFAULT_CACHE_PATH): void {
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const tmpPath = path + '.tmp';
  writeFileSync(tmpPath, JSON.stringify(cache, null, 2) + '\n');
  renameSync(tmpPath, path);
}

export function isCacheStale(cache: DepsCache | null, intervalHours: number): boolean {
  if (!cache) return true;
  const age = Date.now() - new Date(cache.lastScan).getTime();
  return age > intervalHours * 60 * 60 * 1000;
}

export function cachePath(): string {
  return DEFAULT_CACHE_PATH;
}
