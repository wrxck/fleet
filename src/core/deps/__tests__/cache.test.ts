import { readFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { defaultConfig } from '../config.js';
import { loadCache, saveCache, isCacheStale } from '../cache.js';
import type { DepsCache } from '../types.js';

let tmpDir: string;

function makeCache(overrides: Partial<DepsCache> = {}): DepsCache {
  return {
    version: 1,
    lastScan: new Date().toISOString(),
    scanDurationMs: 1000,
    findings: [],
    errors: [],
    config: defaultConfig(),
    ...overrides,
  };
}

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'fleet-deps-cache-test-'));
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('loadCache', () => {
  it('returns null when no cache exists', () => {
    expect(loadCache(join(tmpDir, 'nonexistent.json'))).toBeNull();
  });

  it('loads existing cache', () => {
    const path = join(tmpDir, 'cache.json');
    const original = makeCache({ scanDurationMs: 9999 });
    saveCache(original, path);
    const loaded = loadCache(path);
    expect(loaded).not.toBeNull();
    expect(loaded!.scanDurationMs).toBe(9999);
  });
});

describe('saveCache', () => {
  it('writes cache atomically', () => {
    const path = join(tmpDir, 'cache.json');
    saveCache(makeCache(), path);
    expect(existsSync(path)).toBe(true);
    const parsed = JSON.parse(readFileSync(path, 'utf-8'));
    expect(parsed.version).toBe(1);
  });

  it('creates parent directory if missing', () => {
    const path = join(tmpDir, 'sub', 'deep', 'cache.json');
    saveCache(makeCache(), path);
    expect(existsSync(path)).toBe(true);
  });
});

describe('isCacheStale', () => {
  it('returns true when cache is null', () => {
    expect(isCacheStale(null, 6)).toBe(true);
  });

  it('returns false for fresh cache', () => {
    expect(isCacheStale(makeCache(), 6)).toBe(false);
  });

  it('returns true for old cache', () => {
    const old = new Date(Date.now() - 7 * 60 * 60 * 1000).toISOString();
    expect(isCacheStale(makeCache({ lastScan: old }), 6)).toBe(true);
  });
});
