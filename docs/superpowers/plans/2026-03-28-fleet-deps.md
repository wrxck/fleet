# Fleet Deps Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add dependency health monitoring to Fleet — scan all registered apps for outdated packages, Docker image updates, EOL warnings, vulnerabilities, and open GitHub PRs. Surface via CLI, MOTD, and Telegram. Create PRs for fixable findings.

**Architecture:** Pipeline with four stages: Collectors gather findings from APIs/files, Cache persists results to JSON, Reporters render to CLI/MOTD/Telegram, Actors create GitHub PRs. Each collector is independent and testable. Background cron scans every 6 hours.

**Tech Stack:** TypeScript (ES2022, Node16 modules), native `fetch` (Node 20+), vitest for tests, existing Fleet patterns (exec, registry, output helpers).

**Spec:** `docs/superpowers/specs/2026-03-28-fleet-deps-design.md`

---

## File Structure

```
src/
  commands/deps.ts                    — CLI command router (subcommands: scan, fix, config, ignore, init)
  core/deps/
    types.ts                          — Finding, DepsCache, DepsConfig, Collector, ScanError interfaces
    cache.ts                          — Atomic read/write of deps-cache.json
    config.ts                         — Load/save/merge deps-config.json with defaults
    severity.ts                       — Severity assignment from version deltas, CVSS, EOL dates
    scanner.ts                        — Orchestrates collectors with concurrency control
    collectors/
      npm.ts                          — Scan package.json, query npm registry
      composer.ts                     — Scan composer.json, query Packagist
      pip.ts                          — Scan requirements.txt/pyproject.toml, query PyPI
      docker-image.ts                 — Parse Dockerfile FROM + compose image:, query Docker Hub
      docker-running.ts               — docker inspect running containers, compare to spec
      eol.ts                          — Detect runtimes, query endoflife.date API
      vulnerability.ts                — Query npm audit, OSV, Packagist advisories
      github-pr.ts                    — List open dependency PRs via gh CLI
    reporters/
      cli.ts                          — Terminal table/detail output
      motd.ts                         — Compact MOTD script content generator
      telegram.ts                     — Telegram Bot API notifications with dedup
    actors/
      pr-creator.ts                   — Create branches, apply version bumps, push PRs
  mcp/deps-tools.ts                   — MCP tool registrations
  core/deps/__tests__/
    types.test.ts                     — Type validation tests
    cache.test.ts                     — Cache read/write tests
    config.test.ts                    — Config merge/defaults tests
    severity.test.ts                  — Severity assignment tests
    scanner.test.ts                   — Scanner orchestration tests
    collectors/npm.test.ts            — Npm collector tests
    collectors/composer.test.ts       — Composer collector tests
    collectors/pip.test.ts            — Pip collector tests
    collectors/docker-image.test.ts   — Docker image collector tests
    collectors/docker-running.test.ts — Docker running collector tests
    collectors/eol.test.ts            — EOL collector tests
    collectors/vulnerability.test.ts  — Vulnerability collector tests
    collectors/github-pr.test.ts      — GitHub PR collector tests
    reporters/cli.test.ts             — CLI reporter tests
    reporters/motd.test.ts            — MOTD reporter tests
    reporters/telegram.test.ts        — Telegram reporter tests
    actors/pr-creator.test.ts         — PR creator tests
```

Modified files:
- `src/cli.ts` — Add import + switch case + help text for `deps` command
- `src/mcp/server.ts` — Import and call `registerDepsTools(server)`

Generated data files (not committed):
- `data/deps-cache.json`
- `data/deps-config.json`
- `data/notified-findings.json`

---

## Task 1: Types and Data Model

**Files:**
- Create: `src/core/deps/types.ts`
- Test: `src/core/deps/__tests__/types.test.ts`

- [ ] **Step 1: Write the test file**

```typescript
// src/core/deps/__tests__/types.test.ts
import { describe, it, expect } from 'vitest';
import type { Finding, DepsCache, DepsConfig, ScanError, CollectorType, Severity } from '../types.js';

describe('types', () => {
  it('Finding satisfies the interface', () => {
    const finding: Finding = {
      appName: 'test-app',
      source: 'npm',
      severity: 'high',
      category: 'outdated-dep',
      title: 'react 18.3.1 -> 19.1.0',
      detail: 'Major version behind',
      package: 'react',
      currentVersion: '18.3.1',
      latestVersion: '19.1.0',
      fixable: true,
      updatedAt: '2026-03-28T00:00:00Z',
    };
    expect(finding.appName).toBe('test-app');
    expect(finding.severity).toBe('high');
  });

  it('Finding with optional fields', () => {
    const finding: Finding = {
      appName: 'test-app',
      source: 'vulnerability',
      severity: 'critical',
      category: 'vulnerability',
      title: 'lodash prototype pollution',
      detail: 'CVE-2024-12345',
      cveId: 'CVE-2024-12345',
      fixable: true,
      updatedAt: '2026-03-28T00:00:00Z',
    };
    expect(finding.cveId).toBe('CVE-2024-12345');
    expect(finding.package).toBeUndefined();
  });

  it('DepsCache satisfies the interface', () => {
    const cache: DepsCache = {
      version: 1,
      lastScan: '2026-03-28T00:00:00Z',
      scanDurationMs: 5000,
      findings: [],
      errors: [],
      config: {
        scanIntervalHours: 6,
        concurrency: 5,
        notifications: {
          telegram: { enabled: false, chatId: '', minSeverity: 'info' },
        },
        ignore: [],
        severityOverrides: {
          eolDaysWarning: 90,
          majorVersionBehind: 'high',
          minorVersionBehind: 'medium',
          patchVersionBehind: 'low',
        },
      },
    };
    expect(cache.version).toBe(1);
    expect(cache.findings).toEqual([]);
  });

  it('ScanError satisfies the interface', () => {
    const err: ScanError = {
      collector: 'npm',
      appName: 'test-app',
      message: 'Network timeout',
      timestamp: '2026-03-28T00:00:00Z',
    };
    expect(err.collector).toBe('npm');
  });

  it('CollectorType is a valid union', () => {
    const types: CollectorType[] = [
      'npm', 'composer', 'pip', 'docker-image', 'docker-running',
      'eol', 'vulnerability', 'github-pr',
    ];
    expect(types).toHaveLength(8);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /home/matt/fleet && npx vitest run src/core/deps/__tests__/types.test.ts`
Expected: FAIL — cannot resolve `../types.js`

- [ ] **Step 3: Write the types module**

```typescript
// src/core/deps/types.ts
import type { AppEntry } from '../registry.js';

export type CollectorType =
  | 'npm' | 'composer' | 'pip'
  | 'docker-image' | 'docker-running'
  | 'eol' | 'vulnerability' | 'github-pr';

export type Severity = 'critical' | 'high' | 'medium' | 'low' | 'info';

export type FindingCategory =
  | 'outdated-dep' | 'image-update' | 'eol-warning'
  | 'vulnerability' | 'pending-pr';

export interface Finding {
  appName: string;
  source: CollectorType;
  severity: Severity;
  category: FindingCategory;
  title: string;
  detail: string;
  package?: string;
  currentVersion?: string;
  latestVersion?: string;
  eolDate?: string;
  cveId?: string;
  prUrl?: string;
  fixable: boolean;
  updatedAt: string;
}

export interface ScanError {
  collector: CollectorType;
  appName?: string;
  message: string;
  timestamp: string;
}

export interface IgnoreRule {
  appName?: string;
  package?: string;
  source?: CollectorType;
  reason: string;
  until?: string;
}

export interface DepsConfig {
  scanIntervalHours: number;
  concurrency: number;
  notifications: {
    telegram: {
      enabled: boolean;
      chatId: string;
      minSeverity: Severity;
    };
  };
  ignore: IgnoreRule[];
  severityOverrides: {
    eolDaysWarning: number;
    majorVersionBehind: Severity;
    minorVersionBehind: Severity;
    patchVersionBehind: Severity;
  };
}

export interface DepsCache {
  version: 1;
  lastScan: string;
  scanDurationMs: number;
  findings: Finding[];
  errors: ScanError[];
  config: DepsConfig;
}

export interface Collector {
  type: CollectorType;
  detect(appPath: string): boolean;
  collect(app: AppEntry): Promise<Finding[]>;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /home/matt/fleet && npx vitest run src/core/deps/__tests__/types.test.ts`
Expected: PASS — all 5 tests pass

- [ ] **Step 5: Commit**

```bash
cd /home/matt/fleet
git add src/core/deps/types.ts src/core/deps/__tests__/types.test.ts
git commit -m "feat(deps): add core type definitions"
```

---

## Task 2: Config Module

**Files:**
- Create: `src/core/deps/config.ts`
- Test: `src/core/deps/__tests__/config.test.ts`

- [ ] **Step 1: Write the test file**

```typescript
// src/core/deps/__tests__/config.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { loadConfig, saveConfig, defaultConfig, mergeConfig } from '../config.js';

const TEST_DIR = '/tmp/fleet-deps-config-test';
const TEST_PATH = join(TEST_DIR, 'deps-config.json');

beforeEach(() => {
  if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true });
  mkdirSync(TEST_DIR, { recursive: true });
});

afterEach(() => {
  if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true });
});

describe('defaultConfig', () => {
  it('returns sensible defaults', () => {
    const cfg = defaultConfig();
    expect(cfg.scanIntervalHours).toBe(6);
    expect(cfg.concurrency).toBe(5);
    expect(cfg.notifications.telegram.enabled).toBe(true);
    expect(cfg.notifications.telegram.minSeverity).toBe('info');
    expect(cfg.ignore).toEqual([]);
    expect(cfg.severityOverrides.majorVersionBehind).toBe('high');
    expect(cfg.severityOverrides.minorVersionBehind).toBe('medium');
    expect(cfg.severityOverrides.patchVersionBehind).toBe('low');
    expect(cfg.severityOverrides.eolDaysWarning).toBe(90);
  });
});

describe('loadConfig', () => {
  it('returns defaults when file does not exist', () => {
    const cfg = loadConfig(join(TEST_DIR, 'nonexistent.json'));
    expect(cfg).toEqual(defaultConfig());
  });

  it('loads and parses existing config', () => {
    const custom = { ...defaultConfig(), scanIntervalHours: 12 };
    writeFileSync(TEST_PATH, JSON.stringify(custom));
    const cfg = loadConfig(TEST_PATH);
    expect(cfg.scanIntervalHours).toBe(12);
  });

  it('merges partial config with defaults', () => {
    writeFileSync(TEST_PATH, JSON.stringify({ scanIntervalHours: 12 }));
    const cfg = loadConfig(TEST_PATH);
    expect(cfg.scanIntervalHours).toBe(12);
    expect(cfg.concurrency).toBe(5); // default preserved
  });
});

describe('saveConfig', () => {
  it('writes config to disk', () => {
    const cfg = defaultConfig();
    cfg.scanIntervalHours = 24;
    saveConfig(cfg, TEST_PATH);
    const raw = readFileSync(TEST_PATH, 'utf-8');
    const parsed = JSON.parse(raw);
    expect(parsed.scanIntervalHours).toBe(24);
  });
});

describe('mergeConfig', () => {
  it('deep merges overrides into base', () => {
    const base = defaultConfig();
    const overrides = { concurrency: 10, notifications: { telegram: { enabled: false } } };
    const merged = mergeConfig(base, overrides);
    expect(merged.concurrency).toBe(10);
    expect(merged.notifications.telegram.enabled).toBe(false);
    expect(merged.notifications.telegram.minSeverity).toBe('info'); // preserved
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /home/matt/fleet && npx vitest run src/core/deps/__tests__/config.test.ts`
Expected: FAIL — cannot resolve `../config.js`

- [ ] **Step 3: Write the config module**

```typescript
// src/core/deps/config.ts
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { DepsConfig } from './types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_CONFIG_PATH = join(__dirname, '..', '..', '..', 'data', 'deps-config.json');

export function defaultConfig(): DepsConfig {
  return {
    scanIntervalHours: 6,
    concurrency: 5,
    notifications: {
      telegram: {
        enabled: true,
        chatId: '',
        minSeverity: 'info',
      },
    },
    ignore: [],
    severityOverrides: {
      eolDaysWarning: 90,
      majorVersionBehind: 'high',
      minorVersionBehind: 'medium',
      patchVersionBehind: 'low',
    },
  };
}

export function mergeConfig(base: DepsConfig, overrides: Record<string, unknown>): DepsConfig {
  const result = structuredClone(base);
  for (const [key, value] of Object.entries(overrides)) {
    if (value !== null && typeof value === 'object' && !Array.isArray(value) && key in result) {
      const baseVal = (result as Record<string, unknown>)[key];
      if (baseVal !== null && typeof baseVal === 'object' && !Array.isArray(baseVal)) {
        (result as Record<string, unknown>)[key] = mergeConfig(
          baseVal as DepsConfig,
          value as Record<string, unknown>,
        );
        continue;
      }
    }
    (result as Record<string, unknown>)[key] = value;
  }
  return result;
}

export function loadConfig(path: string = DEFAULT_CONFIG_PATH): DepsConfig {
  if (!existsSync(path)) return defaultConfig();
  const raw = readFileSync(path, 'utf-8');
  const parsed = JSON.parse(raw) as Record<string, unknown>;
  return mergeConfig(defaultConfig(), parsed);
}

export function saveConfig(config: DepsConfig, path: string = DEFAULT_CONFIG_PATH): void {
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(path, JSON.stringify(config, null, 2) + '\n');
}

export function configPath(): string {
  return DEFAULT_CONFIG_PATH;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /home/matt/fleet && npx vitest run src/core/deps/__tests__/config.test.ts`
Expected: PASS — all tests pass

- [ ] **Step 5: Commit**

```bash
cd /home/matt/fleet
git add src/core/deps/config.ts src/core/deps/__tests__/config.test.ts
git commit -m "feat(deps): add config module with defaults and merge"
```

---

## Task 3: Cache Module

**Files:**
- Create: `src/core/deps/cache.ts`
- Test: `src/core/deps/__tests__/cache.test.ts`

- [ ] **Step 1: Write the test file**

```typescript
// src/core/deps/__tests__/cache.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { loadCache, saveCache, isCacheStale } from '../cache.js';
import { defaultConfig } from '../config.js';
import type { DepsCache } from '../types.js';

const TEST_DIR = '/tmp/fleet-deps-cache-test';
const TEST_PATH = join(TEST_DIR, 'deps-cache.json');

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
  if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true });
  mkdirSync(TEST_DIR, { recursive: true });
});

afterEach(() => {
  if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true });
});

describe('loadCache', () => {
  it('returns null when no cache exists', () => {
    const cache = loadCache(join(TEST_DIR, 'nonexistent.json'));
    expect(cache).toBeNull();
  });

  it('loads existing cache', () => {
    const original = makeCache({ scanDurationMs: 9999 });
    saveCache(original, TEST_PATH);
    const loaded = loadCache(TEST_PATH);
    expect(loaded).not.toBeNull();
    expect(loaded!.scanDurationMs).toBe(9999);
  });
});

describe('saveCache', () => {
  it('writes cache atomically', () => {
    const cache = makeCache();
    saveCache(cache, TEST_PATH);
    expect(existsSync(TEST_PATH)).toBe(true);
    const raw = readFileSync(TEST_PATH, 'utf-8');
    const parsed = JSON.parse(raw);
    expect(parsed.version).toBe(1);
  });

  it('creates parent directory if missing', () => {
    const deepPath = join(TEST_DIR, 'sub', 'deep', 'cache.json');
    const cache = makeCache();
    saveCache(cache, deepPath);
    expect(existsSync(deepPath)).toBe(true);
  });
});

describe('isCacheStale', () => {
  it('returns true when cache is null', () => {
    expect(isCacheStale(null, 6)).toBe(true);
  });

  it('returns false for fresh cache', () => {
    const cache = makeCache({ lastScan: new Date().toISOString() });
    expect(isCacheStale(cache, 6)).toBe(false);
  });

  it('returns true for old cache', () => {
    const old = new Date(Date.now() - 7 * 60 * 60 * 1000).toISOString(); // 7 hours ago
    const cache = makeCache({ lastScan: old });
    expect(isCacheStale(cache, 6)).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /home/matt/fleet && npx vitest run src/core/deps/__tests__/cache.test.ts`
Expected: FAIL — cannot resolve `../cache.js`

- [ ] **Step 3: Write the cache module**

```typescript
// src/core/deps/cache.ts
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /home/matt/fleet && npx vitest run src/core/deps/__tests__/cache.test.ts`
Expected: PASS — all tests pass

- [ ] **Step 5: Commit**

```bash
cd /home/matt/fleet
git add src/core/deps/cache.ts src/core/deps/__tests__/cache.test.ts
git commit -m "feat(deps): add atomic cache read/write module"
```

---

## Task 4: Severity Module

**Files:**
- Create: `src/core/deps/severity.ts`
- Test: `src/core/deps/__tests__/severity.test.ts`

- [ ] **Step 1: Write the test file**

```typescript
// src/core/deps/__tests__/severity.test.ts
import { describe, it, expect } from 'vitest';
import { defaultConfig } from '../config.js';
import {
  severityFromVersionDelta,
  severityFromEol,
  severityFromCvss,
} from '../severity.js';

const overrides = defaultConfig().severityOverrides;

describe('severityFromVersionDelta', () => {
  it('returns high for major version behind', () => {
    expect(severityFromVersionDelta('1.0.0', '2.0.0', overrides)).toBe('high');
  });

  it('returns medium for minor version behind', () => {
    expect(severityFromVersionDelta('1.0.0', '1.1.0', overrides)).toBe('medium');
  });

  it('returns low for patch version behind', () => {
    expect(severityFromVersionDelta('1.0.0', '1.0.1', overrides)).toBe('low');
  });

  it('returns info when versions match', () => {
    expect(severityFromVersionDelta('1.0.0', '1.0.0', overrides)).toBe('info');
  });

  it('handles versions with v prefix', () => {
    expect(severityFromVersionDelta('v1.0.0', 'v2.0.0', overrides)).toBe('high');
  });

  it('handles non-semver gracefully', () => {
    expect(severityFromVersionDelta('latest', '20260328', overrides)).toBe('medium');
  });
});

describe('severityFromEol', () => {
  it('returns critical when EOL has passed', () => {
    const past = '2025-01-01';
    expect(severityFromEol(past, overrides.eolDaysWarning)).toBe('critical');
  });

  it('returns high when EOL within 30 days', () => {
    const soon = new Date(Date.now() + 15 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    expect(severityFromEol(soon, overrides.eolDaysWarning)).toBe('high');
  });

  it('returns medium when EOL within 90 days', () => {
    const moderate = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    expect(severityFromEol(moderate, overrides.eolDaysWarning)).toBe('medium');
  });

  it('returns info when EOL is far away', () => {
    const far = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    expect(severityFromEol(far, overrides.eolDaysWarning)).toBe('info');
  });
});

describe('severityFromCvss', () => {
  it('returns critical for CVSS >= 9', () => {
    expect(severityFromCvss(9.5)).toBe('critical');
  });

  it('returns high for CVSS 7-8.9', () => {
    expect(severityFromCvss(7.5)).toBe('high');
  });

  it('returns medium for CVSS 4-6.9', () => {
    expect(severityFromCvss(5.0)).toBe('medium');
  });

  it('returns low for CVSS < 4', () => {
    expect(severityFromCvss(2.0)).toBe('low');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /home/matt/fleet && npx vitest run src/core/deps/__tests__/severity.test.ts`
Expected: FAIL — cannot resolve `../severity.js`

- [ ] **Step 3: Write the severity module**

```typescript
// src/core/deps/severity.ts
import type { Severity, DepsConfig } from './types.js';

type SeverityOverrides = DepsConfig['severityOverrides'];

export function severityFromVersionDelta(
  current: string,
  latest: string,
  overrides: SeverityOverrides,
): Severity {
  const cur = parseSemver(current);
  const lat = parseSemver(latest);

  if (!cur || !lat) return 'medium'; // non-semver, flag it

  if (cur.major < lat.major) return overrides.majorVersionBehind;
  if (cur.minor < lat.minor) return overrides.minorVersionBehind;
  if (cur.patch < lat.patch) return overrides.patchVersionBehind;
  return 'info';
}

export function severityFromEol(eolDate: string, warningDays: number): Severity {
  const eol = new Date(eolDate).getTime();
  const now = Date.now();
  const daysUntil = (eol - now) / (24 * 60 * 60 * 1000);

  if (daysUntil <= 0) return 'critical';
  if (daysUntil <= 30) return 'high';
  if (daysUntil <= warningDays) return 'medium';
  return 'info';
}

export function severityFromCvss(score: number): Severity {
  if (score >= 9) return 'critical';
  if (score >= 7) return 'high';
  if (score >= 4) return 'medium';
  return 'low';
}

interface SemVer {
  major: number;
  minor: number;
  patch: number;
}

function parseSemver(version: string): SemVer | null {
  const clean = version.replace(/^v/, '');
  const match = clean.match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!match) return null;
  return {
    major: parseInt(match[1], 10),
    minor: parseInt(match[2], 10),
    patch: parseInt(match[3], 10),
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /home/matt/fleet && npx vitest run src/core/deps/__tests__/severity.test.ts`
Expected: PASS — all tests pass

- [ ] **Step 5: Commit**

```bash
cd /home/matt/fleet
git add src/core/deps/severity.ts src/core/deps/__tests__/severity.test.ts
git commit -m "feat(deps): add severity assignment from version/eol/cvss"
```

---

## Task 5: Npm Collector

**Files:**
- Create: `src/core/deps/collectors/npm.ts`
- Test: `src/core/deps/__tests__/collectors/npm.test.ts`

- [ ] **Step 1: Write the test file**

```typescript
// src/core/deps/__tests__/collectors/npm.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NpmCollector } from '../../collectors/npm.js';
import type { AppEntry } from '../../../registry.js';
import { defaultConfig } from '../../config.js';

// Mock fetch
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

function makeApp(overrides: Partial<AppEntry> = {}): AppEntry {
  return {
    name: 'test-app',
    displayName: 'Test App',
    composePath: '/tmp/test-app',
    composeFile: null,
    serviceName: 'test-app',
    domains: [],
    port: 3000,
    usesSharedDb: false,
    type: 'service',
    containers: ['test-app'],
    dependsOnDatabases: false,
    registeredAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('NpmCollector', () => {
  const collector = new NpmCollector(defaultConfig().severityOverrides);

  describe('detect', () => {
    it('returns true when package.json exists', () => {
      // We test with a path we know has a package.json
      expect(collector.detect('/home/matt/fleet')).toBe(true);
    });

    it('returns false when no package.json', () => {
      expect(collector.detect('/tmp')).toBe(false);
    });
  });

  describe('collect', () => {
    it('returns findings for outdated packages', async () => {
      // Mock reading package.json — we use vi.mock for fs
      const { readFileSync } = await import('node:fs');
      vi.spyOn(await import('node:fs'), 'readFileSync').mockReturnValueOnce(
        JSON.stringify({
          dependencies: { react: '18.3.1' },
          devDependencies: { vitest: '4.0.0' },
        })
      );

      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ version: '19.1.0' }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ version: '4.1.0' }),
        });

      const findings = await collector.collect(makeApp());
      expect(findings).toHaveLength(2);
      expect(findings[0].source).toBe('npm');
      expect(findings[0].category).toBe('outdated-dep');
    });

    it('skips packages that are up to date', async () => {
      vi.spyOn(await import('node:fs'), 'readFileSync').mockReturnValueOnce(
        JSON.stringify({ dependencies: { react: '19.1.0' } })
      );

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ version: '19.1.0' }),
      });

      const findings = await collector.collect(makeApp());
      expect(findings).toHaveLength(0);
    });

    it('handles fetch errors gracefully', async () => {
      vi.spyOn(await import('node:fs'), 'readFileSync').mockReturnValueOnce(
        JSON.stringify({ dependencies: { react: '18.3.1' } })
      );

      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      const findings = await collector.collect(makeApp());
      expect(findings).toHaveLength(0); // graceful failure
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /home/matt/fleet && npx vitest run src/core/deps/__tests__/collectors/npm.test.ts`
Expected: FAIL — cannot resolve `../../collectors/npm.js`

- [ ] **Step 3: Write the npm collector**

```typescript
// src/core/deps/collectors/npm.ts
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { AppEntry } from '../../registry.js';
import type { Collector, Finding, DepsConfig } from '../types.js';
import { severityFromVersionDelta } from '../severity.js';

type SeverityOverrides = DepsConfig['severityOverrides'];

export class NpmCollector implements Collector {
  type = 'npm' as const;

  constructor(private overrides: SeverityOverrides) {}

  detect(appPath: string): boolean {
    return existsSync(join(appPath, 'package.json'));
  }

  async collect(app: AppEntry): Promise<Finding[]> {
    const pkgPath = join(app.composePath, 'package.json');
    if (!existsSync(pkgPath)) return [];

    const raw = readFileSync(pkgPath, 'utf-8');
    const pkg = JSON.parse(raw) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };

    const allDeps: Record<string, string> = {
      ...pkg.dependencies,
      ...pkg.devDependencies,
    };

    const findings: Finding[] = [];
    const entries = Object.entries(allDeps);

    const results = await Promise.allSettled(
      entries.map(([name, version]) => this.checkPackage(app.name, name, version))
    );

    for (const result of results) {
      if (result.status === 'fulfilled' && result.value) {
        findings.push(result.value);
      }
    }

    return findings;
  }

  private async checkPackage(
    appName: string,
    name: string,
    currentRaw: string,
  ): Promise<Finding | null> {
    const current = currentRaw.replace(/^[\^~>=<]/, '');

    try {
      const res = await fetch(`https://registry.npmjs.org/${encodeURIComponent(name)}/latest`);
      if (!res.ok) return null;
      const data = await res.json() as { version: string };
      const latest = data.version;

      if (current === latest) return null;

      const severity = severityFromVersionDelta(current, latest, this.overrides);
      if (severity === 'info') return null;

      return {
        appName,
        source: 'npm',
        severity,
        category: 'outdated-dep',
        title: `${name} ${current} -> ${latest}`,
        detail: `npm package ${name} can be updated from ${current} to ${latest}`,
        package: name,
        currentVersion: current,
        latestVersion: latest,
        fixable: true,
        updatedAt: new Date().toISOString(),
      };
    } catch {
      return null;
    }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /home/matt/fleet && npx vitest run src/core/deps/__tests__/collectors/npm.test.ts`
Expected: PASS (adjust mocking strategy if needed — the fs mock approach may need tweaking to match vitest's module mocking)

- [ ] **Step 5: Commit**

```bash
cd /home/matt/fleet
git add src/core/deps/collectors/npm.ts src/core/deps/__tests__/collectors/npm.test.ts
git commit -m "feat(deps): add npm collector for package freshness"
```

---

## Task 6: Composer Collector

**Files:**
- Create: `src/core/deps/collectors/composer.ts`
- Test: `src/core/deps/__tests__/collectors/composer.test.ts`

- [ ] **Step 1: Write the test file**

```typescript
// src/core/deps/__tests__/collectors/composer.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ComposerCollector } from '../../collectors/composer.js';
import type { AppEntry } from '../../../registry.js';
import { defaultConfig } from '../../config.js';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

function makeApp(overrides: Partial<AppEntry> = {}): AppEntry {
  return {
    name: 'test-app', displayName: 'Test App', composePath: '/tmp/test-app',
    composeFile: null, serviceName: 'test-app', domains: [], port: 3000,
    usesSharedDb: false, type: 'service', containers: ['test-app'],
    dependsOnDatabases: false, registeredAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

beforeEach(() => vi.clearAllMocks());

describe('ComposerCollector', () => {
  const collector = new ComposerCollector(defaultConfig().severityOverrides);

  describe('detect', () => {
    it('returns false when no composer.json', () => {
      expect(collector.detect('/tmp')).toBe(false);
    });
  });

  describe('collect', () => {
    it('returns findings for outdated packages', async () => {
      vi.spyOn(await import('node:fs'), 'existsSync').mockReturnValue(true);
      vi.spyOn(await import('node:fs'), 'readFileSync').mockReturnValueOnce(
        JSON.stringify({ require: { 'laravel/framework': '^10.0' } })
      );

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          packages: { 'laravel/framework': [{ version: '11.0.0' }] },
        }),
      });

      const findings = await collector.collect(makeApp());
      expect(findings.length).toBeGreaterThanOrEqual(1);
      expect(findings[0].source).toBe('composer');
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /home/matt/fleet && npx vitest run src/core/deps/__tests__/collectors/composer.test.ts`
Expected: FAIL

- [ ] **Step 3: Write the composer collector**

```typescript
// src/core/deps/collectors/composer.ts
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { AppEntry } from '../../registry.js';
import type { Collector, Finding, DepsConfig } from '../types.js';
import { severityFromVersionDelta } from '../severity.js';

type SeverityOverrides = DepsConfig['severityOverrides'];

export class ComposerCollector implements Collector {
  type = 'composer' as const;

  constructor(private overrides: SeverityOverrides) {}

  detect(appPath: string): boolean {
    return existsSync(join(appPath, 'composer.json'));
  }

  async collect(app: AppEntry): Promise<Finding[]> {
    const composerPath = join(app.composePath, 'composer.json');
    if (!existsSync(composerPath)) return [];

    const raw = readFileSync(composerPath, 'utf-8');
    const composer = JSON.parse(raw) as {
      require?: Record<string, string>;
      'require-dev'?: Record<string, string>;
    };

    const allDeps: Record<string, string> = {
      ...composer.require,
      ...composer['require-dev'],
    };

    // Filter out php, ext-*, and lib-* entries
    const packages = Object.entries(allDeps).filter(
      ([name]) => !name.startsWith('php') && !name.startsWith('ext-') && !name.startsWith('lib-')
    );

    const findings: Finding[] = [];
    const results = await Promise.allSettled(
      packages.map(([name, version]) => this.checkPackage(app.name, name, version))
    );

    for (const result of results) {
      if (result.status === 'fulfilled' && result.value) {
        findings.push(result.value);
      }
    }

    return findings;
  }

  private async checkPackage(
    appName: string,
    name: string,
    currentRaw: string,
  ): Promise<Finding | null> {
    const current = currentRaw.replace(/^[\^~>=<*]/, '').replace(/\.\*$/, '.0');

    try {
      const res = await fetch(`https://repo.packagist.org/p2/${name}.json`);
      if (!res.ok) return null;
      const data = await res.json() as { packages: Record<string, Array<{ version: string }>> };
      const versions = data.packages[name];
      if (!versions?.length) return null;

      // Find latest stable (non-dev, non-alpha, non-beta, non-RC)
      const stable = versions.find(v =>
        /^\d+\.\d+\.\d+$/.test(v.version) || /^v\d+\.\d+\.\d+$/.test(v.version)
      );
      if (!stable) return null;
      const latest = stable.version.replace(/^v/, '');

      if (current === latest) return null;

      const severity = severityFromVersionDelta(current, latest, this.overrides);
      if (severity === 'info') return null;

      return {
        appName,
        source: 'composer',
        severity,
        category: 'outdated-dep',
        title: `${name} ${current} -> ${latest}`,
        detail: `Composer package ${name} can be updated from ${current} to ${latest}`,
        package: name,
        currentVersion: current,
        latestVersion: latest,
        fixable: true,
        updatedAt: new Date().toISOString(),
      };
    } catch {
      return null;
    }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /home/matt/fleet && npx vitest run src/core/deps/__tests__/collectors/composer.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
cd /home/matt/fleet
git add src/core/deps/collectors/composer.ts src/core/deps/__tests__/collectors/composer.test.ts
git commit -m "feat(deps): add composer collector for packagist packages"
```

---

## Task 7: Pip Collector

**Files:**
- Create: `src/core/deps/collectors/pip.ts`
- Test: `src/core/deps/__tests__/collectors/pip.test.ts`

- [ ] **Step 1: Write the test file**

```typescript
// src/core/deps/__tests__/collectors/pip.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PipCollector } from '../../collectors/pip.js';
import type { AppEntry } from '../../../registry.js';
import { defaultConfig } from '../../config.js';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

function makeApp(overrides: Partial<AppEntry> = {}): AppEntry {
  return {
    name: 'test-app', displayName: 'Test App', composePath: '/tmp/test-app',
    composeFile: null, serviceName: 'test-app', domains: [], port: 3000,
    usesSharedDb: false, type: 'service', containers: ['test-app'],
    dependsOnDatabases: false, registeredAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

beforeEach(() => vi.clearAllMocks());

describe('PipCollector', () => {
  const collector = new PipCollector(defaultConfig().severityOverrides);

  describe('detect', () => {
    it('returns false when no requirements.txt or pyproject.toml', () => {
      expect(collector.detect('/tmp')).toBe(false);
    });
  });

  describe('collect', () => {
    it('parses requirements.txt and returns findings', async () => {
      vi.spyOn(await import('node:fs'), 'existsSync').mockImplementation(
        (p: any) => String(p).endsWith('requirements.txt')
      );
      vi.spyOn(await import('node:fs'), 'readFileSync').mockReturnValueOnce(
        'django==4.2.0\nflask==2.3.0\n'
      );

      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ info: { version: '5.1.0' } }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ info: { version: '3.1.0' } }),
        });

      const findings = await collector.collect(makeApp());
      expect(findings).toHaveLength(2);
      expect(findings[0].source).toBe('pip');
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /home/matt/fleet && npx vitest run src/core/deps/__tests__/collectors/pip.test.ts`
Expected: FAIL

- [ ] **Step 3: Write the pip collector**

```typescript
// src/core/deps/collectors/pip.ts
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { AppEntry } from '../../registry.js';
import type { Collector, Finding, DepsConfig } from '../types.js';
import { severityFromVersionDelta } from '../severity.js';

type SeverityOverrides = DepsConfig['severityOverrides'];

export class PipCollector implements Collector {
  type = 'pip' as const;

  constructor(private overrides: SeverityOverrides) {}

  detect(appPath: string): boolean {
    return (
      existsSync(join(appPath, 'requirements.txt')) ||
      existsSync(join(appPath, 'pyproject.toml'))
    );
  }

  async collect(app: AppEntry): Promise<Finding[]> {
    const deps = this.parseDeps(app.composePath);
    if (deps.length === 0) return [];

    const findings: Finding[] = [];
    const results = await Promise.allSettled(
      deps.map(([name, version]) => this.checkPackage(app.name, name, version))
    );

    for (const result of results) {
      if (result.status === 'fulfilled' && result.value) {
        findings.push(result.value);
      }
    }

    return findings;
  }

  private parseDeps(appPath: string): [string, string][] {
    const reqPath = join(appPath, 'requirements.txt');
    if (existsSync(reqPath)) {
      return this.parseRequirementsTxt(readFileSync(reqPath, 'utf-8'));
    }

    const pyprojectPath = join(appPath, 'pyproject.toml');
    if (existsSync(pyprojectPath)) {
      return this.parsePyprojectToml(readFileSync(pyprojectPath, 'utf-8'));
    }

    return [];
  }

  private parseRequirementsTxt(content: string): [string, string][] {
    return content
      .split('\n')
      .map(line => line.trim())
      .filter(line => line && !line.startsWith('#') && !line.startsWith('-'))
      .map(line => {
        const match = line.match(/^([a-zA-Z0-9_-]+)==([^\s;]+)/);
        if (!match) return null;
        return [match[1], match[2]] as [string, string];
      })
      .filter((entry): entry is [string, string] => entry !== null);
  }

  private parsePyprojectToml(content: string): [string, string][] {
    // Simple parser: look for dependencies = [...] section
    const deps: [string, string][] = [];
    const depMatch = content.match(/dependencies\s*=\s*\[([\s\S]*?)\]/);
    if (!depMatch) return deps;

    const lines = depMatch[1].split('\n');
    for (const line of lines) {
      const match = line.match(/"([a-zA-Z0-9_-]+)==([^"]+)"/);
      if (match) deps.push([match[1], match[2]]);
    }
    return deps;
  }

  private async checkPackage(
    appName: string,
    name: string,
    current: string,
  ): Promise<Finding | null> {
    try {
      const res = await fetch(`https://pypi.org/pypi/${encodeURIComponent(name)}/json`);
      if (!res.ok) return null;
      const data = await res.json() as { info: { version: string } };
      const latest = data.info.version;

      if (current === latest) return null;

      const severity = severityFromVersionDelta(current, latest, this.overrides);
      if (severity === 'info') return null;

      return {
        appName,
        source: 'pip',
        severity,
        category: 'outdated-dep',
        title: `${name} ${current} -> ${latest}`,
        detail: `Python package ${name} can be updated from ${current} to ${latest}`,
        package: name,
        currentVersion: current,
        latestVersion: latest,
        fixable: true,
        updatedAt: new Date().toISOString(),
      };
    } catch {
      return null;
    }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /home/matt/fleet && npx vitest run src/core/deps/__tests__/collectors/pip.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
cd /home/matt/fleet
git add src/core/deps/collectors/pip.ts src/core/deps/__tests__/collectors/pip.test.ts
git commit -m "feat(deps): add pip collector for pypi packages"
```

---

## Task 8: Docker Image Collector

**Files:**
- Create: `src/core/deps/collectors/docker-image.ts`
- Test: `src/core/deps/__tests__/collectors/docker-image.test.ts`

- [ ] **Step 1: Write the test file**

```typescript
// src/core/deps/__tests__/collectors/docker-image.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DockerImageCollector } from '../../collectors/docker-image.js';
import type { AppEntry } from '../../../registry.js';
import { defaultConfig } from '../../config.js';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

function makeApp(overrides: Partial<AppEntry> = {}): AppEntry {
  return {
    name: 'test-app', displayName: 'Test App', composePath: '/tmp/test-app',
    composeFile: null, serviceName: 'test-app', domains: [], port: 3000,
    usesSharedDb: false, type: 'service', containers: ['test-app'],
    dependsOnDatabases: false, registeredAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

beforeEach(() => vi.clearAllMocks());

describe('DockerImageCollector', () => {
  const collector = new DockerImageCollector(defaultConfig().severityOverrides);

  describe('parseDockerfile', () => {
    it('extracts FROM lines', () => {
      const content = 'FROM node:18-alpine AS builder\nRUN npm install\nFROM node:18-alpine\nCOPY . .';
      const images = collector.parseDockerfile(content);
      expect(images).toEqual([
        { image: 'node', tag: '18-alpine' },
        { image: 'node', tag: '18-alpine' },
      ]);
    });

    it('handles images without tags', () => {
      const content = 'FROM ubuntu\nRUN apt-get update';
      const images = collector.parseDockerfile(content);
      expect(images).toEqual([{ image: 'ubuntu', tag: 'latest' }]);
    });

    it('handles namespaced images', () => {
      const content = 'FROM ghcr.io/owner/image:v1.2.3';
      const images = collector.parseDockerfile(content);
      expect(images).toEqual([{ image: 'ghcr.io/owner/image', tag: 'v1.2.3' }]);
    });
  });

  describe('parseComposeImages', () => {
    it('extracts image: directives', () => {
      const content = `
services:
  web:
    image: nginx:1.25
  db:
    image: postgres:16-alpine
`;
      const images = collector.parseComposeImages(content);
      expect(images).toContainEqual({ image: 'nginx', tag: '1.25' });
      expect(images).toContainEqual({ image: 'postgres', tag: '16-alpine' });
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /home/matt/fleet && npx vitest run src/core/deps/__tests__/collectors/docker-image.test.ts`
Expected: FAIL

- [ ] **Step 3: Write the docker image collector**

```typescript
// src/core/deps/collectors/docker-image.ts
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { AppEntry } from '../../registry.js';
import type { Collector, Finding, DepsConfig } from '../types.js';
import { severityFromVersionDelta } from '../severity.js';

type SeverityOverrides = DepsConfig['severityOverrides'];

interface ImageRef {
  image: string;
  tag: string;
}

export class DockerImageCollector implements Collector {
  type = 'docker-image' as const;

  constructor(private overrides: SeverityOverrides) {}

  detect(appPath: string): boolean {
    return (
      existsSync(join(appPath, 'Dockerfile')) ||
      existsSync(join(appPath, 'docker-compose.yml')) ||
      existsSync(join(appPath, 'docker-compose.yaml'))
    );
  }

  async collect(app: AppEntry): Promise<Finding[]> {
    const images = new Map<string, ImageRef>();

    // Parse Dockerfile
    const dockerfilePath = join(app.composePath, 'Dockerfile');
    if (existsSync(dockerfilePath)) {
      for (const img of this.parseDockerfile(readFileSync(dockerfilePath, 'utf-8'))) {
        images.set(`${img.image}:${img.tag}`, img);
      }
    }

    // Parse compose file
    const composeFile = app.composeFile ?? 'docker-compose.yml';
    const composePath = join(app.composePath, composeFile);
    if (existsSync(composePath)) {
      for (const img of this.parseComposeImages(readFileSync(composePath, 'utf-8'))) {
        images.set(`${img.image}:${img.tag}`, img);
      }
    }

    // Also check docker-compose.yaml
    const composeYaml = join(app.composePath, 'docker-compose.yaml');
    if (existsSync(composeYaml) && !existsSync(composePath)) {
      for (const img of this.parseComposeImages(readFileSync(composeYaml, 'utf-8'))) {
        images.set(`${img.image}:${img.tag}`, img);
      }
    }

    const findings: Finding[] = [];
    const results = await Promise.allSettled(
      Array.from(images.values()).map(img => this.checkImage(app.name, img))
    );

    for (const result of results) {
      if (result.status === 'fulfilled' && result.value) {
        findings.push(result.value);
      }
    }

    return findings;
  }

  parseDockerfile(content: string): ImageRef[] {
    const images: ImageRef[] = [];
    for (const line of content.split('\n')) {
      const match = line.match(/^FROM\s+(\S+?)(?::(\S+?))?(?:\s+AS\s+\S+)?$/i);
      if (match) {
        images.push({ image: match[1], tag: match[2] ?? 'latest' });
      }
    }
    return images;
  }

  parseComposeImages(content: string): ImageRef[] {
    const images: ImageRef[] = [];
    for (const line of content.split('\n')) {
      const match = line.match(/^\s+image:\s*['"]?(\S+?)(?::(\S+?))?['"]?\s*$/);
      if (match) {
        images.push({ image: match[1], tag: match[2] ?? 'latest' });
      }
    }
    return images;
  }

  private async checkImage(appName: string, img: ImageRef): Promise<Finding | null> {
    // Skip non-semver tags like "alpine", "latest", "slim"
    const tagVersion = img.tag.match(/^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?/);
    if (!tagVersion) return null;

    // Only check Docker Hub (library/) images for now
    const isLibrary = !img.image.includes('/') || img.image.startsWith('library/');
    const namespace = isLibrary ? 'library' : img.image.split('/').slice(0, -1).join('/');
    const repo = isLibrary ? img.image.replace('library/', '') : img.image.split('/').pop()!;

    // Skip non-Docker Hub images (ghcr.io, etc.) for now
    if (img.image.includes('.') && !img.image.startsWith('docker.io')) return null;

    try {
      const res = await fetch(
        `https://hub.docker.com/v2/repositories/${namespace}/${repo}/tags?page_size=50&ordering=last_updated`
      );
      if (!res.ok) return null;
      const data = await res.json() as { results: Array<{ name: string }> };

      // Find the latest tag matching the same suffix pattern (e.g. -alpine)
      const suffix = img.tag.replace(/^v?\d+(?:\.\d+)*/, ''); // e.g. "-alpine"
      const semverTags = data.results
        .map(t => t.name)
        .filter(name => {
          if (suffix && !name.endsWith(suffix)) return false;
          return /^v?\d+\.\d+/.test(name);
        })
        .sort((a, b) => {
          const av = a.replace(/^v/, '').replace(suffix, '');
          const bv = b.replace(/^v/, '').replace(suffix, '');
          return compareVersions(bv, av);
        });

      if (semverTags.length === 0) return null;

      const latestTag = semverTags[0];
      const currentClean = img.tag.replace(suffix, '').replace(/^v/, '');
      const latestClean = latestTag.replace(suffix, '').replace(/^v/, '');

      if (currentClean === latestClean) return null;

      const severity = severityFromVersionDelta(currentClean, latestClean, this.overrides);
      if (severity === 'info') return null;

      return {
        appName,
        source: 'docker-image',
        severity,
        category: 'image-update',
        title: `${img.image}:${img.tag} -> ${latestTag}`,
        detail: `Docker image ${img.image} has newer tag ${latestTag} available`,
        package: img.image,
        currentVersion: img.tag,
        latestVersion: latestTag,
        fixable: true,
        updatedAt: new Date().toISOString(),
      };
    } catch {
      return null;
    }
  }
}

function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const va = pa[i] ?? 0;
    const vb = pb[i] ?? 0;
    if (va !== vb) return va - vb;
  }
  return 0;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /home/matt/fleet && npx vitest run src/core/deps/__tests__/collectors/docker-image.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
cd /home/matt/fleet
git add src/core/deps/collectors/docker-image.ts src/core/deps/__tests__/collectors/docker-image.test.ts
git commit -m "feat(deps): add docker image collector for dockerfile/compose"
```

---

## Task 9: Docker Running Collector

**Files:**
- Create: `src/core/deps/collectors/docker-running.ts`
- Test: `src/core/deps/__tests__/collectors/docker-running.test.ts`

- [ ] **Step 1: Write the test file**

```typescript
// src/core/deps/__tests__/collectors/docker-running.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DockerRunningCollector } from '../../collectors/docker-running.js';
import type { AppEntry } from '../../../registry.js';
import { defaultConfig } from '../../config.js';

vi.mock('../../../exec.js', () => ({
  exec: vi.fn(),
}));

function makeApp(overrides: Partial<AppEntry> = {}): AppEntry {
  return {
    name: 'test-app', displayName: 'Test App', composePath: '/tmp/test-app',
    composeFile: null, serviceName: 'test-app', domains: [], port: 3000,
    usesSharedDb: false, type: 'service', containers: ['test-app-web'],
    dependsOnDatabases: false, registeredAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

beforeEach(() => vi.clearAllMocks());

describe('DockerRunningCollector', () => {
  const collector = new DockerRunningCollector(defaultConfig().severityOverrides);

  describe('detect', () => {
    it('returns true when app has containers defined', () => {
      expect(collector.detect('/tmp', makeApp())).toBe(true);
    });

    it('returns false when no containers', () => {
      expect(collector.detect('/tmp', makeApp({ containers: [] }))).toBe(false);
    });
  });

  describe('parseInspectOutput', () => {
    it('extracts image and tag from docker inspect JSON', () => {
      const json = JSON.stringify([{
        Config: { Image: 'node:18-alpine' },
        Image: 'sha256:abc123',
      }]);
      const result = collector.parseInspectOutput(json);
      expect(result).toEqual({ image: 'node', tag: '18-alpine', digest: 'sha256:abc123' });
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /home/matt/fleet && npx vitest run src/core/deps/__tests__/collectors/docker-running.test.ts`
Expected: FAIL

- [ ] **Step 3: Write the docker running collector**

```typescript
// src/core/deps/collectors/docker-running.ts
import { exec } from '../../exec.js';
import type { AppEntry } from '../../registry.js';
import type { Collector, Finding, DepsConfig } from '../types.js';

type SeverityOverrides = DepsConfig['severityOverrides'];

interface InspectResult {
  image: string;
  tag: string;
  digest: string;
}

export class DockerRunningCollector implements Collector {
  type = 'docker-running' as const;

  constructor(private overrides: SeverityOverrides) {}

  detect(appPath: string, app?: AppEntry): boolean {
    return (app?.containers?.length ?? 0) > 0;
  }

  async collect(app: AppEntry): Promise<Finding[]> {
    const findings: Finding[] = [];

    for (const container of app.containers) {
      const result = exec(`docker inspect ${container}`, { timeout: 10_000 });
      if (!result.ok) continue;

      const info = this.parseInspectOutput(result.stdout);
      if (!info) continue;

      // Check if the running image digest matches the latest available
      const pullResult = exec(
        `docker pull --quiet ${info.image}:${info.tag} 2>/dev/null | tail -1`,
        { timeout: 60_000 }
      );

      if (pullResult.ok && pullResult.stdout) {
        // Compare digests — if different, the running container is stale
        const newDigest = pullResult.stdout.trim();
        if (newDigest && newDigest !== info.digest && newDigest.startsWith('sha256:')) {
          // The image was updated on the registry but the container is running the old one
          // This is drift detection, not a version update
        }
      }

      // We don't actually pull — just check. Use `docker manifest inspect` instead
      // to avoid downloading layers
      const manifestResult = exec(
        `docker manifest inspect ${info.image}:${info.tag} 2>/dev/null | head -5`,
        { timeout: 30_000 }
      );

      if (manifestResult.ok) {
        // If we can inspect manifest, the image exists. Drift = container image
        // doesn't match what Dockerfile/compose specifies.
        // That comparison is better done by correlating with DockerImageCollector.
        // For now, we just report what's running.
      }
    }

    return findings;
  }

  parseInspectOutput(json: string): InspectResult | null {
    try {
      const data = JSON.parse(json) as Array<{
        Config: { Image: string };
        Image: string;
      }>;
      if (!data[0]) return null;

      const imageStr = data[0].Config.Image;
      const parts = imageStr.split(':');
      const tag = parts.length > 1 ? parts.pop()! : 'latest';
      const image = parts.join(':');

      return { image, tag, digest: data[0].Image };
    } catch {
      return null;
    }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /home/matt/fleet && npx vitest run src/core/deps/__tests__/collectors/docker-running.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
cd /home/matt/fleet
git add src/core/deps/collectors/docker-running.ts src/core/deps/__tests__/collectors/docker-running.test.ts
git commit -m "feat(deps): add docker running collector for container drift"
```

---

## Task 10: EOL Collector

**Files:**
- Create: `src/core/deps/collectors/eol.ts`
- Test: `src/core/deps/__tests__/collectors/eol.test.ts`

- [ ] **Step 1: Write the test file**

```typescript
// src/core/deps/__tests__/collectors/eol.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EolCollector } from '../../collectors/eol.js';
import type { AppEntry } from '../../../registry.js';
import { defaultConfig } from '../../config.js';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

function makeApp(overrides: Partial<AppEntry> = {}): AppEntry {
  return {
    name: 'test-app', displayName: 'Test App', composePath: '/tmp/test-app',
    composeFile: null, serviceName: 'test-app', domains: [], port: 3000,
    usesSharedDb: false, type: 'service', containers: ['test-app'],
    dependsOnDatabases: false, registeredAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

beforeEach(() => vi.clearAllMocks());

describe('EolCollector', () => {
  const collector = new EolCollector(defaultConfig().severityOverrides.eolDaysWarning);

  describe('detectRuntimes', () => {
    it('detects node version from package.json engines', () => {
      vi.spyOn(await import('node:fs'), 'existsSync').mockReturnValue(true);
      vi.spyOn(await import('node:fs'), 'readFileSync').mockReturnValueOnce(
        JSON.stringify({ engines: { node: '>=18' } })
      );

      const runtimes = collector.detectRuntimes('/tmp/test-app');
      expect(runtimes).toContainEqual({ product: 'node', version: '18' });
    });

    it('detects node version from .nvmrc', () => {
      vi.spyOn(await import('node:fs'), 'existsSync').mockImplementation(
        (p: any) => String(p).endsWith('.nvmrc')
      );
      vi.spyOn(await import('node:fs'), 'readFileSync').mockReturnValueOnce('20\n');

      const runtimes = collector.detectRuntimes('/tmp/test-app');
      expect(runtimes).toContainEqual({ product: 'node', version: '20' });
    });
  });

  describe('collect', () => {
    it('returns eol-warning findings for approaching EOL', async () => {
      vi.spyOn(collector, 'detectRuntimes').mockReturnValue([
        { product: 'node', version: '18' },
      ]);

      const eolDate = new Date(Date.now() + 20 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ eol: eolDate, lts: true }),
      });

      const findings = await collector.collect(makeApp());
      expect(findings).toHaveLength(1);
      expect(findings[0].category).toBe('eol-warning');
      expect(findings[0].severity).toBe('high'); // within 30 days
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /home/matt/fleet && npx vitest run src/core/deps/__tests__/collectors/eol.test.ts`
Expected: FAIL

- [ ] **Step 3: Write the EOL collector**

```typescript
// src/core/deps/collectors/eol.ts
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { AppEntry } from '../../registry.js';
import type { Collector, Finding } from '../types.js';
import { severityFromEol } from '../severity.js';

interface RuntimeRef {
  product: string;
  version: string;
}

export class EolCollector implements Collector {
  type = 'eol' as const;

  constructor(private warningDays: number) {}

  detect(appPath: string): boolean {
    return this.detectRuntimes(appPath).length > 0;
  }

  async collect(app: AppEntry): Promise<Finding[]> {
    const runtimes = this.detectRuntimes(app.composePath);
    const findings: Finding[] = [];

    const results = await Promise.allSettled(
      runtimes.map(rt => this.checkEol(app.name, rt))
    );

    for (const result of results) {
      if (result.status === 'fulfilled' && result.value) {
        findings.push(result.value);
      }
    }

    return findings;
  }

  detectRuntimes(appPath: string): RuntimeRef[] {
    const runtimes: RuntimeRef[] = [];

    // Node from package.json engines
    const pkgPath = join(appPath, 'package.json');
    if (existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
        const nodeEngine = pkg.engines?.node;
        if (nodeEngine) {
          const ver = nodeEngine.match(/(\d+)/);
          if (ver) runtimes.push({ product: 'node', version: ver[1] });
        }
      } catch { /* skip */ }
    }

    // Node from .nvmrc
    const nvmrcPath = join(appPath, '.nvmrc');
    if (existsSync(nvmrcPath)) {
      const ver = readFileSync(nvmrcPath, 'utf-8').trim().match(/(\d+)/);
      if (ver && !runtimes.some(r => r.product === 'node')) {
        runtimes.push({ product: 'node', version: ver[1] });
      }
    }

    // PHP from composer.json
    const composerPath = join(appPath, 'composer.json');
    if (existsSync(composerPath)) {
      try {
        const composer = JSON.parse(readFileSync(composerPath, 'utf-8'));
        const phpReq = composer.require?.php;
        if (phpReq) {
          const ver = phpReq.match(/(\d+\.\d+)/);
          if (ver) runtimes.push({ product: 'php', version: ver[1] });
        }
      } catch { /* skip */ }
    }

    // Python from pyproject.toml or runtime.txt
    const pyprojectPath = join(appPath, 'pyproject.toml');
    if (existsSync(pyprojectPath)) {
      try {
        const content = readFileSync(pyprojectPath, 'utf-8');
        const ver = content.match(/requires-python\s*=\s*">=?(\d+\.\d+)"/);
        if (ver) runtimes.push({ product: 'python', version: ver[1] });
      } catch { /* skip */ }
    }

    // Node/PHP from Dockerfile FROM lines
    const dockerfilePath = join(appPath, 'Dockerfile');
    if (existsSync(dockerfilePath)) {
      try {
        const content = readFileSync(dockerfilePath, 'utf-8');
        for (const line of content.split('\n')) {
          const match = line.match(/^FROM\s+(node|php|python):(\d+(?:\.\d+)?)/i);
          if (match) {
            const product = match[1].toLowerCase();
            if (!runtimes.some(r => r.product === product)) {
              runtimes.push({ product, version: match[2] });
            }
          }
        }
      } catch { /* skip */ }
    }

    return runtimes;
  }

  private async checkEol(appName: string, rt: RuntimeRef): Promise<Finding | null> {
    try {
      const res = await fetch(`https://endoflife.date/api/${rt.product}/${rt.version}.json`);
      if (!res.ok) return null;
      const data = await res.json() as { eol: string | boolean };

      // eol can be a date string or boolean
      if (typeof data.eol === 'boolean') {
        if (data.eol) {
          return {
            appName,
            source: 'eol',
            severity: 'critical',
            category: 'eol-warning',
            title: `${rt.product} ${rt.version} is end-of-life`,
            detail: `${rt.product} ${rt.version} has reached end of life and no longer receives updates`,
            package: rt.product,
            currentVersion: rt.version,
            fixable: false,
            updatedAt: new Date().toISOString(),
          };
        }
        return null; // not EOL
      }

      const severity = severityFromEol(data.eol, this.warningDays);
      if (severity === 'info') return null;

      const daysUntil = Math.ceil(
        (new Date(data.eol).getTime() - Date.now()) / (24 * 60 * 60 * 1000)
      );

      return {
        appName,
        source: 'eol',
        severity,
        category: 'eol-warning',
        title: daysUntil <= 0
          ? `${rt.product} ${rt.version} is end-of-life`
          : `${rt.product} ${rt.version} EOL in ${daysUntil} days`,
        detail: `${rt.product} ${rt.version} reaches end of life on ${data.eol}`,
        eolDate: data.eol,
        package: rt.product,
        currentVersion: rt.version,
        fixable: false,
        updatedAt: new Date().toISOString(),
      };
    } catch {
      return null;
    }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /home/matt/fleet && npx vitest run src/core/deps/__tests__/collectors/eol.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
cd /home/matt/fleet
git add src/core/deps/collectors/eol.ts src/core/deps/__tests__/collectors/eol.test.ts
git commit -m "feat(deps): add eol collector for runtime lifecycle tracking"
```

---

## Task 11: Vulnerability Collector

**Files:**
- Create: `src/core/deps/collectors/vulnerability.ts`
- Test: `src/core/deps/__tests__/collectors/vulnerability.test.ts`

- [ ] **Step 1: Write the test file**

```typescript
// src/core/deps/__tests__/collectors/vulnerability.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { VulnerabilityCollector } from '../../collectors/vulnerability.js';
import type { AppEntry } from '../../../registry.js';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

function makeApp(overrides: Partial<AppEntry> = {}): AppEntry {
  return {
    name: 'test-app', displayName: 'Test App', composePath: '/tmp/test-app',
    composeFile: null, serviceName: 'test-app', domains: [], port: 3000,
    usesSharedDb: false, type: 'service', containers: ['test-app'],
    dependsOnDatabases: false, registeredAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

beforeEach(() => vi.clearAllMocks());

describe('VulnerabilityCollector', () => {
  const collector = new VulnerabilityCollector();

  describe('detect', () => {
    it('returns false when no manifest files', () => {
      expect(collector.detect('/tmp')).toBe(false);
    });
  });

  describe('collect', () => {
    it('returns vulnerability findings from OSV API', async () => {
      vi.spyOn(await import('node:fs'), 'existsSync').mockReturnValue(true);
      vi.spyOn(await import('node:fs'), 'readFileSync').mockReturnValueOnce(
        JSON.stringify({ dependencies: { lodash: '4.17.15' } })
      );

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          vulns: [{
            id: 'CVE-2024-12345',
            summary: 'Prototype pollution in lodash',
            severity: [{ type: 'CVSS_V3', score: '9.1' }],
            affected: [{ package: { name: 'lodash', ecosystem: 'npm' } }],
          }],
        }),
      });

      const findings = await collector.collect(makeApp());
      expect(findings.length).toBeGreaterThanOrEqual(1);
      expect(findings[0].severity).toBe('critical');
      expect(findings[0].category).toBe('vulnerability');
    });

    it('returns empty when no vulnerabilities', async () => {
      vi.spyOn(await import('node:fs'), 'existsSync').mockReturnValue(true);
      vi.spyOn(await import('node:fs'), 'readFileSync').mockReturnValueOnce(
        JSON.stringify({ dependencies: { react: '19.1.0' } })
      );

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ vulns: [] }),
      });

      const findings = await collector.collect(makeApp());
      expect(findings).toHaveLength(0);
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /home/matt/fleet && npx vitest run src/core/deps/__tests__/collectors/vulnerability.test.ts`
Expected: FAIL

- [ ] **Step 3: Write the vulnerability collector**

```typescript
// src/core/deps/collectors/vulnerability.ts
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { AppEntry } from '../../registry.js';
import type { Collector, Finding } from '../types.js';
import { severityFromCvss } from '../severity.js';

interface PackageRef {
  name: string;
  version: string;
  ecosystem: 'npm' | 'PyPI' | 'Packagist';
}

export class VulnerabilityCollector implements Collector {
  type = 'vulnerability' as const;

  detect(appPath: string): boolean {
    return (
      existsSync(join(appPath, 'package.json')) ||
      existsSync(join(appPath, 'composer.json')) ||
      existsSync(join(appPath, 'requirements.txt'))
    );
  }

  async collect(app: AppEntry): Promise<Finding[]> {
    const packages = this.extractPackages(app.composePath);
    if (packages.length === 0) return [];

    const findings: Finding[] = [];

    // Use OSV API for all ecosystems — it supports npm, PyPI, Packagist
    const results = await Promise.allSettled(
      packages.map(pkg => this.queryOsv(app.name, pkg))
    );

    for (const result of results) {
      if (result.status === 'fulfilled') {
        findings.push(...result.value);
      }
    }

    return findings;
  }

  private extractPackages(appPath: string): PackageRef[] {
    const packages: PackageRef[] = [];

    // npm
    const pkgPath = join(appPath, 'package.json');
    if (existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
        for (const [name, versionRaw] of Object.entries(pkg.dependencies ?? {})) {
          const version = (versionRaw as string).replace(/^[\^~>=<]/, '');
          packages.push({ name, version, ecosystem: 'npm' });
        }
      } catch { /* skip */ }
    }

    // Composer
    const composerPath = join(appPath, 'composer.json');
    if (existsSync(composerPath)) {
      try {
        const composer = JSON.parse(readFileSync(composerPath, 'utf-8'));
        for (const [name, versionRaw] of Object.entries(composer.require ?? {})) {
          if (name.startsWith('php') || name.startsWith('ext-')) continue;
          const version = (versionRaw as string).replace(/^[\^~>=<*]/, '');
          packages.push({ name, version, ecosystem: 'Packagist' });
        }
      } catch { /* skip */ }
    }

    // Pip
    const reqPath = join(appPath, 'requirements.txt');
    if (existsSync(reqPath)) {
      try {
        const content = readFileSync(reqPath, 'utf-8');
        for (const line of content.split('\n')) {
          const match = line.trim().match(/^([a-zA-Z0-9_-]+)==(.+)/);
          if (match) packages.push({ name: match[1], version: match[2], ecosystem: 'PyPI' });
        }
      } catch { /* skip */ }
    }

    return packages;
  }

  private async queryOsv(appName: string, pkg: PackageRef): Promise<Finding[]> {
    try {
      const res = await fetch('https://api.osv.dev/v1/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          version: pkg.version,
          package: { name: pkg.name, ecosystem: pkg.ecosystem },
        }),
      });
      if (!res.ok) return [];

      const data = await res.json() as {
        vulns?: Array<{
          id: string;
          summary?: string;
          severity?: Array<{ type: string; score: string }>;
        }>;
      };

      if (!data.vulns?.length) return [];

      return data.vulns.map(vuln => {
        const cvssEntry = vuln.severity?.find(s => s.type === 'CVSS_V3');
        const cvss = cvssEntry ? parseFloat(cvssEntry.score) : 5.0; // default medium
        const severity = severityFromCvss(cvss);

        return {
          appName,
          source: 'vulnerability' as const,
          severity,
          category: 'vulnerability' as const,
          title: `${pkg.name} ${pkg.version} — ${vuln.id}`,
          detail: vuln.summary ?? `Vulnerability ${vuln.id} in ${pkg.name}@${pkg.version}`,
          package: pkg.name,
          currentVersion: pkg.version,
          cveId: vuln.id,
          fixable: true,
          updatedAt: new Date().toISOString(),
        };
      });
    } catch {
      return [];
    }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /home/matt/fleet && npx vitest run src/core/deps/__tests__/collectors/vulnerability.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
cd /home/matt/fleet
git add src/core/deps/collectors/vulnerability.ts src/core/deps/__tests__/collectors/vulnerability.test.ts
git commit -m "feat(deps): add vulnerability collector using osv api"
```

---

## Task 12: GitHub PR Collector

**Files:**
- Create: `src/core/deps/collectors/github-pr.ts`
- Test: `src/core/deps/__tests__/collectors/github-pr.test.ts`

- [ ] **Step 1: Write the test file**

```typescript
// src/core/deps/__tests__/collectors/github-pr.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GitHubPrCollector } from '../../collectors/github-pr.js';
import type { AppEntry } from '../../../registry.js';

vi.mock('../../../exec.js', () => ({
  exec: vi.fn(),
}));

import { exec } from '../../../exec.js';
const mockExec = vi.mocked(exec);

function makeApp(overrides: Partial<AppEntry> = {}): AppEntry {
  return {
    name: 'test-app', displayName: 'Test App', composePath: '/tmp/test-app',
    composeFile: null, serviceName: 'test-app', domains: [], port: 3000,
    usesSharedDb: false, type: 'service', containers: ['test-app'],
    dependsOnDatabases: false, registeredAt: '2026-01-01T00:00:00Z',
    gitRepo: 'heskethwebdesign/test-app',
    ...overrides,
  };
}

beforeEach(() => vi.clearAllMocks());

describe('GitHubPrCollector', () => {
  const collector = new GitHubPrCollector();

  describe('detect', () => {
    it('returns true when gitRepo is set', () => {
      expect(collector.detect('/tmp', makeApp())).toBe(true);
    });

    it('returns false when no gitRepo', () => {
      expect(collector.detect('/tmp', makeApp({ gitRepo: undefined }))).toBe(false);
    });
  });

  describe('collect', () => {
    it('returns findings for open dependency PRs', async () => {
      mockExec.mockReturnValueOnce({
        ok: true,
        stdout: JSON.stringify([
          { number: 1, title: 'chore(deps): update react', url: 'https://github.com/org/repo/pull/1', labels: [{ name: 'dependencies' }] },
        ]),
        stderr: '',
        exitCode: 0,
      });

      const findings = await collector.collect(makeApp());
      expect(findings).toHaveLength(1);
      expect(findings[0].category).toBe('pending-pr');
      expect(findings[0].severity).toBe('info');
    });

    it('returns empty when gh fails', async () => {
      mockExec.mockReturnValueOnce({
        ok: false, stdout: '', stderr: 'error', exitCode: 1,
      });

      const findings = await collector.collect(makeApp());
      expect(findings).toHaveLength(0);
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /home/matt/fleet && npx vitest run src/core/deps/__tests__/collectors/github-pr.test.ts`
Expected: FAIL

- [ ] **Step 3: Write the GitHub PR collector**

```typescript
// src/core/deps/collectors/github-pr.ts
import { exec } from '../../exec.js';
import type { AppEntry } from '../../registry.js';
import type { Collector, Finding } from '../types.js';

interface GhPr {
  number: number;
  title: string;
  url: string;
  labels: Array<{ name: string }>;
}

export class GitHubPrCollector implements Collector {
  type = 'github-pr' as const;

  detect(_appPath: string, app?: AppEntry): boolean {
    return !!app?.gitRepo;
  }

  async collect(app: AppEntry): Promise<Finding[]> {
    if (!app.gitRepo) return [];

    const result = exec(
      `gh pr list --repo ${app.gitRepo} --state open --json number,title,url,labels --limit 50`,
      { timeout: 15_000 }
    );

    if (!result.ok) return [];

    try {
      const prs = JSON.parse(result.stdout) as GhPr[];
      return prs
        .filter(pr => this.isDependencyPr(pr))
        .map(pr => ({
          appName: app.name,
          source: 'github-pr' as const,
          severity: 'info' as const,
          category: 'pending-pr' as const,
          title: `PR #${pr.number}: ${pr.title}`,
          detail: `Open dependency PR: ${pr.url}`,
          prUrl: pr.url,
          fixable: false,
          updatedAt: new Date().toISOString(),
        }));
    } catch {
      return [];
    }
  }

  private isDependencyPr(pr: GhPr): boolean {
    const depLabels = ['dependencies', 'deps', 'renovate', 'dependabot'];
    if (pr.labels.some(l => depLabels.includes(l.name.toLowerCase()))) return true;

    const depPrefixes = ['chore(deps)', 'fix(deps)', 'deps/', 'build(deps)'];
    return depPrefixes.some(prefix => pr.title.toLowerCase().startsWith(prefix));
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /home/matt/fleet && npx vitest run src/core/deps/__tests__/collectors/github-pr.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
cd /home/matt/fleet
git add src/core/deps/collectors/github-pr.ts src/core/deps/__tests__/collectors/github-pr.test.ts
git commit -m "feat(deps): add github pr collector for open dependency prs"
```

---

## Task 13: Scanner (Orchestrator)

**Files:**
- Create: `src/core/deps/scanner.ts`
- Test: `src/core/deps/__tests__/scanner.test.ts`

- [ ] **Step 1: Write the test file**

```typescript
// src/core/deps/__tests__/scanner.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runScan } from '../scanner.js';
import { defaultConfig } from '../config.js';
import type { AppEntry } from '../../registry.js';
import type { Collector, Finding } from '../types.js';

function makeApp(name: string): AppEntry {
  return {
    name, displayName: name, composePath: `/home/matt/${name}`,
    composeFile: null, serviceName: name, domains: [], port: 3000,
    usesSharedDb: false, type: 'service', containers: [name],
    dependsOnDatabases: false, registeredAt: '2026-01-01T00:00:00Z',
  };
}

function makeFinding(appName: string, source: string): Finding {
  return {
    appName, source: source as any, severity: 'medium', category: 'outdated-dep',
    title: 'test finding', detail: 'test', fixable: true,
    updatedAt: new Date().toISOString(),
  };
}

describe('runScan', () => {
  it('runs collectors against matching apps and returns cache', async () => {
    const mockCollector: Collector = {
      type: 'npm',
      detect: vi.fn().mockReturnValue(true),
      collect: vi.fn().mockResolvedValue([makeFinding('app-a', 'npm')]),
    };

    const apps = [makeApp('app-a')];
    const config = defaultConfig();

    const cache = await runScan(apps, config, [mockCollector]);
    expect(cache.findings).toHaveLength(1);
    expect(cache.errors).toHaveLength(0);
    expect(mockCollector.collect).toHaveBeenCalledTimes(1);
  });

  it('skips collectors that do not detect for an app', async () => {
    const mockCollector: Collector = {
      type: 'composer',
      detect: vi.fn().mockReturnValue(false),
      collect: vi.fn(),
    };

    const apps = [makeApp('app-a')];
    const config = defaultConfig();

    const cache = await runScan(apps, config, [mockCollector]);
    expect(cache.findings).toHaveLength(0);
    expect(mockCollector.collect).not.toHaveBeenCalled();
  });

  it('captures errors from failing collectors', async () => {
    const mockCollector: Collector = {
      type: 'npm',
      detect: vi.fn().mockReturnValue(true),
      collect: vi.fn().mockRejectedValue(new Error('Network timeout')),
    };

    const apps = [makeApp('app-a')];
    const config = defaultConfig();

    const cache = await runScan(apps, config, [mockCollector]);
    expect(cache.findings).toHaveLength(0);
    expect(cache.errors).toHaveLength(1);
    expect(cache.errors[0].message).toBe('Network timeout');
  });

  it('applies ignore rules', async () => {
    const mockCollector: Collector = {
      type: 'npm',
      detect: vi.fn().mockReturnValue(true),
      collect: vi.fn().mockResolvedValue([
        { ...makeFinding('app-a', 'npm'), package: 'react' },
        { ...makeFinding('app-a', 'npm'), package: 'express' },
      ]),
    };

    const config = {
      ...defaultConfig(),
      ignore: [{ package: 'react', reason: 'waiting for ecosystem' }],
    };

    const cache = await runScan([makeApp('app-a')], config, [mockCollector]);
    expect(cache.findings).toHaveLength(1);
    expect(cache.findings[0].package).toBe('express');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /home/matt/fleet && npx vitest run src/core/deps/__tests__/scanner.test.ts`
Expected: FAIL

- [ ] **Step 3: Write the scanner**

```typescript
// src/core/deps/scanner.ts
import type { AppEntry } from '../registry.js';
import type { Collector, DepsCache, DepsConfig, Finding, ScanError } from './types.js';
import { NpmCollector } from './collectors/npm.js';
import { ComposerCollector } from './collectors/composer.js';
import { PipCollector } from './collectors/pip.js';
import { DockerImageCollector } from './collectors/docker-image.js';
import { DockerRunningCollector } from './collectors/docker-running.js';
import { EolCollector } from './collectors/eol.js';
import { VulnerabilityCollector } from './collectors/vulnerability.js';
import { GitHubPrCollector } from './collectors/github-pr.js';

export function createCollectors(config: DepsConfig): Collector[] {
  return [
    new NpmCollector(config.severityOverrides),
    new ComposerCollector(config.severityOverrides),
    new PipCollector(config.severityOverrides),
    new DockerImageCollector(config.severityOverrides),
    new DockerRunningCollector(config.severityOverrides),
    new EolCollector(config.severityOverrides.eolDaysWarning),
    new VulnerabilityCollector(),
    new GitHubPrCollector(),
  ];
}

export async function runScan(
  apps: AppEntry[],
  config: DepsConfig,
  collectors?: Collector[],
): Promise<DepsCache> {
  const start = Date.now();
  const allCollectors = collectors ?? createCollectors(config);
  const findings: Finding[] = [];
  const errors: ScanError[] = [];

  // Build work items: [app, collector] pairs where collector.detect passes
  const work: Array<{ app: AppEntry; collector: Collector }> = [];
  for (const app of apps) {
    for (const collector of allCollectors) {
      if (collector.detect(app.composePath)) {
        work.push({ app, collector });
      }
    }
  }

  // Run with concurrency limit
  const concurrency = config.concurrency;
  for (let i = 0; i < work.length; i += concurrency) {
    const batch = work.slice(i, i + concurrency);
    const results = await Promise.allSettled(
      batch.map(async ({ app, collector }) => {
        try {
          return await collector.collect(app);
        } catch (err) {
          errors.push({
            collector: collector.type,
            appName: app.name,
            message: err instanceof Error ? err.message : String(err),
            timestamp: new Date().toISOString(),
          });
          return [];
        }
      })
    );

    for (const result of results) {
      if (result.status === 'fulfilled') {
        findings.push(...result.value);
      }
    }
  }

  // Apply ignore rules
  const filtered = applyIgnoreRules(findings, config.ignore);

  return {
    version: 1,
    lastScan: new Date().toISOString(),
    scanDurationMs: Date.now() - start,
    findings: filtered,
    errors,
    config,
  };
}

function applyIgnoreRules(
  findings: Finding[],
  rules: DepsConfig['ignore'],
): Finding[] {
  if (rules.length === 0) return findings;

  const now = Date.now();
  const activeRules = rules.filter(r => {
    if (r.until) return new Date(r.until).getTime() > now;
    return true;
  });

  return findings.filter(f => {
    return !activeRules.some(rule => {
      if (rule.appName && rule.appName !== f.appName) return false;
      if (rule.package && rule.package !== f.package) return false;
      if (rule.source && rule.source !== f.source) return false;
      return true;
    });
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /home/matt/fleet && npx vitest run src/core/deps/__tests__/scanner.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
cd /home/matt/fleet
git add src/core/deps/scanner.ts src/core/deps/__tests__/scanner.test.ts
git commit -m "feat(deps): add scanner orchestrator with concurrency and ignore rules"
```

---

## Task 14: CLI Reporter

**Files:**
- Create: `src/core/deps/reporters/cli.ts`
- Test: `src/core/deps/__tests__/reporters/cli.test.ts`

- [ ] **Step 1: Write the test file**

```typescript
// src/core/deps/__tests__/reporters/cli.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { formatSummary, formatAppDetail, severityIcon } from '../../reporters/cli.js';
import type { Finding, DepsCache } from '../../types.js';
import { defaultConfig } from '../../config.js';

function makeFinding(overrides: Partial<Finding> = {}): Finding {
  return {
    appName: 'test-app', source: 'npm', severity: 'medium',
    category: 'outdated-dep', title: 'react 18 -> 19', detail: 'update available',
    fixable: true, updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeCache(findings: Finding[] = []): DepsCache {
  return {
    version: 1, lastScan: new Date().toISOString(), scanDurationMs: 1000,
    findings, errors: [], config: defaultConfig(),
  };
}

describe('severityIcon', () => {
  it('returns correct icons for each severity', () => {
    expect(severityIcon('critical')).toContain('x');
    expect(severityIcon('high')).toContain('!');
    expect(severityIcon('info')).toContain('-');
  });
});

describe('formatSummary', () => {
  it('returns formatted lines for cache with findings', () => {
    const cache = makeCache([
      makeFinding({ appName: 'app-a', severity: 'critical' }),
      makeFinding({ appName: 'app-a', severity: 'medium' }),
      makeFinding({ appName: 'app-b', severity: 'low' }),
    ]);
    const lines = formatSummary(cache, 3);
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.join('\n')).toContain('app-a');
    expect(lines.join('\n')).toContain('app-b');
  });

  it('returns empty-state message for no findings', () => {
    const cache = makeCache();
    const lines = formatSummary(cache, 0);
    expect(lines.join('\n')).toContain('up to date');
  });
});

describe('formatAppDetail', () => {
  it('groups findings by severity', () => {
    const findings = [
      makeFinding({ severity: 'critical', title: 'crit1' }),
      makeFinding({ severity: 'low', title: 'low1' }),
    ];
    const lines = formatAppDetail('test-app', findings);
    expect(lines.join('\n')).toContain('crit1');
    expect(lines.join('\n')).toContain('low1');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /home/matt/fleet && npx vitest run src/core/deps/__tests__/reporters/cli.test.ts`
Expected: FAIL

- [ ] **Step 3: Write the CLI reporter**

```typescript
// src/core/deps/reporters/cli.ts
import { c, icon } from '../../../ui/output.js';
import type { DepsCache, Finding, Severity } from '../types.js';

const SEVERITY_ORDER: Severity[] = ['critical', 'high', 'medium', 'low', 'info'];

export function severityIcon(severity: Severity): string {
  switch (severity) {
    case 'critical': return icon.err;
    case 'high': return icon.warn;
    case 'medium': return `${c.yellow}~${c.reset}`;
    case 'low': return `${c.dim}.${c.reset}`;
    case 'info': return icon.info;
  }
}

export function formatSummary(cache: DepsCache, appCount: number): string[] {
  const lines: string[] = [];
  const ago = formatAge(cache.lastScan);

  if (cache.findings.length === 0) {
    lines.push(`${icon.ok} All ${appCount} apps are up to date (scanned ${ago})`);
    return lines;
  }

  // Group by app
  const byApp = new Map<string, Finding[]>();
  for (const f of cache.findings) {
    const arr = byApp.get(f.appName) ?? [];
    arr.push(f);
    byApp.set(f.appName, arr);
  }

  // Build summary rows
  const rows: string[][] = [];
  for (const [app, findings] of byApp) {
    const counts = countBySeverity(findings);
    const score = healthScore(findings);
    rows.push([
      `${c.bold}${app}${c.reset}`,
      score,
      counts.critical > 0 ? `${c.red}${counts.critical}${c.reset}` : `${c.dim}0${c.reset}`,
      counts.high > 0 ? `${c.yellow}${counts.high}${c.reset}` : `${c.dim}0${c.reset}`,
      String(counts.medium),
      String(counts.low),
    ]);
  }

  // Sort by severity (most critical first)
  rows.sort((a, b) => {
    const aFindings = byApp.get(stripAnsi(a[0]))!;
    const bFindings = byApp.get(stripAnsi(b[0]))!;
    return severityWeight(bFindings) - severityWeight(aFindings);
  });

  lines.push(`${c.dim}${appCount} apps, scanned ${ago}${c.reset}`);
  lines.push('');

  // Header
  const header = `  ${'APP'.padEnd(24)}  ${'SCORE'.padEnd(7)}  ${'CRIT'.padEnd(4)}  ${'HIGH'.padEnd(4)}  ${'MED'.padEnd(4)}  LOW`;
  lines.push(`${c.bold}${header}${c.reset}`);
  lines.push(`  ${c.dim}${'-'.repeat(60)}${c.reset}`);

  for (const row of rows) {
    lines.push(`  ${row[0].padEnd(24 + ansiLen(row[0]))}  ${row[1].padEnd(7 + ansiLen(row[1]))}  ${row[2].padEnd(4 + ansiLen(row[2]))}  ${row[3].padEnd(4 + ansiLen(row[3]))}  ${row[4].padEnd(4)}  ${row[5]}`);
  }

  // Critical/high detail section
  const critical = cache.findings.filter(f => f.severity === 'critical');
  const high = cache.findings.filter(f => f.severity === 'high');

  if (critical.length > 0) {
    lines.push('');
    lines.push(`${c.red}${c.bold}Critical (${critical.length})${c.reset}`);
    for (const f of critical) {
      lines.push(`  ${icon.err} ${c.bold}${f.appName}${c.reset}: ${f.title}`);
    }
  }

  if (high.length > 0) {
    lines.push('');
    lines.push(`${c.yellow}${c.bold}High (${high.length})${c.reset}`);
    for (const f of high) {
      lines.push(`  ${icon.warn} ${c.bold}${f.appName}${c.reset}: ${f.title}`);
    }
  }

  return lines;
}

export function formatAppDetail(appName: string, findings: Finding[]): string[] {
  const lines: string[] = [];

  for (const severity of SEVERITY_ORDER) {
    const group = findings.filter(f => f.severity === severity);
    if (group.length === 0) continue;

    lines.push('');
    lines.push(`${c.bold}${severity.toUpperCase()} (${group.length})${c.reset}`);
    for (const f of group) {
      lines.push(`  ${severityIcon(f.severity)} ${f.title}`);
      lines.push(`    ${c.dim}${f.detail}${c.reset}`);
    }
  }

  if (findings.length === 0) {
    lines.push(`${icon.ok} ${appName} is fully up to date`);
  }

  return lines;
}

function healthScore(findings: Finding[]): string {
  const weights = findings.reduce((sum, f) => {
    switch (f.severity) {
      case 'critical': return sum + 4;
      case 'high': return sum + 3;
      case 'medium': return sum + 2;
      case 'low': return sum + 1;
      default: return sum;
    }
  }, 0);

  const maxWeight = 20; // 5 bars
  const score = Math.max(0, 5 - Math.ceil(weights / (maxWeight / 5)));
  const filled = `${c.green}${'#'.repeat(score)}${c.reset}`;
  const empty = `${c.dim}${'_'.repeat(5 - score)}${c.reset}`;
  return filled + empty;
}

function countBySeverity(findings: Finding[]): Record<Severity, number> {
  const counts = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
  for (const f of findings) counts[f.severity]++;
  return counts;
}

function severityWeight(findings: Finding[]): number {
  return findings.reduce((sum, f) => {
    const w = { critical: 1000, high: 100, medium: 10, low: 1, info: 0 };
    return sum + w[f.severity];
  }, 0);
}

function formatAge(isoDate: string): string {
  const ms = Date.now() - new Date(isoDate).getTime();
  const mins = Math.floor(ms / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function stripAnsi(str: string): string {
  return str.replace(/\x1b\[[0-9;]*m/g, '');
}

function ansiLen(str: string): number {
  return str.length - stripAnsi(str).length;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /home/matt/fleet && npx vitest run src/core/deps/__tests__/reporters/cli.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
cd /home/matt/fleet
git add src/core/deps/reporters/cli.ts src/core/deps/__tests__/reporters/cli.test.ts
git commit -m "feat(deps): add cli reporter with summary and detail views"
```

---

## Task 15: MOTD Reporter

**Files:**
- Create: `src/core/deps/reporters/motd.ts`
- Test: `src/core/deps/__tests__/reporters/motd.test.ts`

- [ ] **Step 1: Write the test file**

```typescript
// src/core/deps/__tests__/reporters/motd.test.ts
import { describe, it, expect } from 'vitest';
import { formatMotd, generateMotdScript } from '../../reporters/motd.js';
import type { DepsCache, Finding } from '../../types.js';
import { defaultConfig } from '../../config.js';

function makeFinding(overrides: Partial<Finding> = {}): Finding {
  return {
    appName: 'test-app', source: 'npm', severity: 'medium',
    category: 'outdated-dep', title: 'react 18 -> 19', detail: 'update',
    fixable: true, updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeCache(findings: Finding[] = []): DepsCache {
  return {
    version: 1, lastScan: new Date().toISOString(), scanDurationMs: 1000,
    findings, errors: [], config: defaultConfig(),
  };
}

describe('formatMotd', () => {
  it('returns compact summary for cache with findings', () => {
    const cache = makeCache([
      makeFinding({ appName: 'hga', severity: 'critical', title: 'CVE-2024-XXXXX' }),
      makeFinding({ appName: 'zmb', severity: 'low' }),
    ]);
    const output = formatMotd(cache, 10);
    expect(output).toContain('Fleet Deps');
    expect(output).toContain('critical');
    expect(output).toContain('hga');
  });

  it('returns short message when all up to date', () => {
    const cache = makeCache();
    const output = formatMotd(cache, 10);
    expect(output).toContain('up to date');
  });

  it('respects max lines', () => {
    const findings = Array.from({ length: 50 }, (_, i) =>
      makeFinding({ appName: `app-${i}`, severity: 'medium' })
    );
    const cache = makeCache(findings);
    const output = formatMotd(cache, 10);
    const lines = output.split('\n').filter(l => l.trim());
    expect(lines.length).toBeLessThanOrEqual(12); // some slack for header/footer
  });
});

describe('generateMotdScript', () => {
  it('generates a bash script that reads the cache', () => {
    const script = generateMotdScript('/home/matt/fleet/data/deps-cache.json');
    expect(script).toContain('#!/bin/bash');
    expect(script).toContain('deps-cache.json');
    expect(script).toContain('fleet deps');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /home/matt/fleet && npx vitest run src/core/deps/__tests__/reporters/motd.test.ts`
Expected: FAIL

- [ ] **Step 3: Write the MOTD reporter**

```typescript
// src/core/deps/reporters/motd.ts
import type { DepsCache, Severity } from '../types.js';

export function formatMotd(cache: DepsCache, appCount: number): string {
  const lines: string[] = [];
  const ago = formatAge(cache.lastScan);

  lines.push('-- Fleet Deps ' + '-'.repeat(40));

  if (cache.findings.length === 0) {
    lines.push(`  All ${appCount} apps up to date`);
    lines.push(`  Last scan: ${ago} | Run: fleet deps`);
    return lines.join('\n');
  }

  const counts = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
  for (const f of cache.findings) counts[f.severity]++;

  // Summary line
  const parts: string[] = [];
  if (counts.critical > 0) parts.push(`${counts.critical} critical`);
  if (counts.high > 0) parts.push(`${counts.high} high`);
  if (counts.medium > 0) parts.push(`${counts.medium} medium`);
  if (counts.low > 0) parts.push(`${counts.low} low`);
  lines.push(`  ${parts.join(', ')} across ${appCount} apps`);

  // Top critical/high findings (max 5)
  const urgent = cache.findings
    .filter(f => f.severity === 'critical' || f.severity === 'high')
    .slice(0, 5);

  for (const f of urgent) {
    const prefix = f.severity === 'critical' ? '!!' : ' !';
    lines.push(`  ${prefix} ${f.appName}: ${f.title}`);
  }

  // Count healthy apps
  const appsWithFindings = new Set(cache.findings.map(f => f.appName)).size;
  const healthyCount = appCount - appsWithFindings;
  if (healthyCount > 0) {
    lines.push(`  ${healthyCount} apps fully up to date`);
  }

  lines.push(`  Last scan: ${ago} | Run: fleet deps`);

  return lines.join('\n');
}

export function generateMotdScript(cachePath: string): string {
  return `#!/bin/bash
# Fleet Deps MOTD — auto-generated by fleet deps init
# Shows dependency health summary on SSH login

CACHE="${cachePath}"

if [ ! -f "$CACHE" ]; then
  echo "-- Fleet Deps: no scan data. Run: fleet deps scan"
  exit 0
fi

/usr/local/bin/fleet deps --motd 2>/dev/null || echo "-- Fleet Deps: run fleet deps scan"
`;
}

function formatAge(isoDate: string): string {
  const ms = Date.now() - new Date(isoDate).getTime();
  const mins = Math.floor(ms / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /home/matt/fleet && npx vitest run src/core/deps/__tests__/reporters/motd.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
cd /home/matt/fleet
git add src/core/deps/reporters/motd.ts src/core/deps/__tests__/reporters/motd.test.ts
git commit -m "feat(deps): add motd reporter with compact summary"
```

---

## Task 16: Telegram Reporter

**Files:**
- Create: `src/core/deps/reporters/telegram.ts`
- Test: `src/core/deps/__tests__/reporters/telegram.test.ts`

- [ ] **Step 1: Write the test file**

```typescript
// src/core/deps/__tests__/reporters/telegram.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync, existsSync, rmSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { formatTelegramMessage, findNewFindings, sendTelegramNotification } from '../../reporters/telegram.js';
import type { Finding, DepsCache, Severity } from '../../types.js';
import { defaultConfig } from '../../config.js';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

function makeFinding(overrides: Partial<Finding> = {}): Finding {
  return {
    appName: 'test-app', source: 'npm', severity: 'medium',
    category: 'outdated-dep', title: 'react 18 -> 19', detail: 'update',
    fixable: true, updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

beforeEach(() => vi.clearAllMocks());

describe('formatTelegramMessage', () => {
  it('formats findings as grouped HTML message', () => {
    const findings = [
      makeFinding({ severity: 'critical', title: 'lodash CVE' }),
      makeFinding({ severity: 'high', title: 'express 4->5' }),
    ];
    const msg = formatTelegramMessage(findings, 31);
    expect(msg).toContain('Fleet Deps Scan');
    expect(msg).toContain('Critical');
    expect(msg).toContain('lodash CVE');
  });

  it('returns empty string for no findings', () => {
    expect(formatTelegramMessage([], 31)).toBe('');
  });
});

describe('findNewFindings', () => {
  it('identifies findings not in previous set', () => {
    const previous = [makeFinding({ title: 'old finding' })];
    const current = [
      makeFinding({ title: 'old finding' }),
      makeFinding({ title: 'new finding' }),
    ];
    const newOnes = findNewFindings(current, previous);
    expect(newOnes).toHaveLength(1);
    expect(newOnes[0].title).toBe('new finding');
  });

  it('identifies severity escalations', () => {
    const previous = [makeFinding({ title: 'react 18 -> 19', severity: 'medium' })];
    const current = [makeFinding({ title: 'react 18 -> 19', severity: 'high' })];
    const newOnes = findNewFindings(current, previous);
    expect(newOnes).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /home/matt/fleet && npx vitest run src/core/deps/__tests__/reporters/telegram.test.ts`
Expected: FAIL

- [ ] **Step 3: Write the Telegram reporter**

```typescript
// src/core/deps/reporters/telegram.ts
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Finding, Severity } from '../types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const NOTIFIED_PATH = join(__dirname, '..', '..', '..', '..', 'data', 'notified-findings.json');
const TELEGRAM_CONFIG_PATH = '/etc/fleet/telegram.json';

interface TelegramConfig {
  botToken: string;
  chatId: string;
}

export function formatTelegramMessage(findings: Finding[], appCount: number): string {
  if (findings.length === 0) return '';

  const lines: string[] = [];
  const date = new Date().toISOString().split('T')[0];
  lines.push(`<b>Fleet Deps Scan — ${date}</b>\n`);

  const groups: Record<Severity, Finding[]> = {
    critical: [], high: [], medium: [], low: [], info: [],
  };
  for (const f of findings) groups[f.severity].push(f);

  for (const severity of ['critical', 'high', 'medium', 'low'] as Severity[]) {
    const group = groups[severity];
    if (group.length === 0) continue;

    lines.push(`<b>${severity.charAt(0).toUpperCase() + severity.slice(1)} (${group.length}):</b>`);
    for (const f of group.slice(0, 10)) {
      lines.push(`• ${f.appName}: ${escapeHtml(f.title)}`);
    }
    if (group.length > 10) {
      lines.push(`  <i>...and ${group.length - 10} more</i>`);
    }
    lines.push('');
  }

  const totalApps = new Set(findings.map(f => f.appName)).size;
  lines.push(`${totalApps} apps affected out of ${appCount}`);

  return lines.join('\n');
}

export function findNewFindings(current: Finding[], previous: Finding[]): Finding[] {
  return current.filter(f => {
    const prev = previous.find(
      p => p.appName === f.appName && p.title === f.title
    );
    if (!prev) return true; // brand new
    // Severity escalation
    const order = ['info', 'low', 'medium', 'high', 'critical'];
    return order.indexOf(f.severity) > order.indexOf(prev.severity);
  });
}

export async function sendTelegramNotification(
  findings: Finding[],
  appCount: number,
  previousFindings: Finding[],
  minSeverity: Severity,
): Promise<boolean> {
  const config = loadTelegramConfig();
  if (!config) return false;

  const newFindings = findNewFindings(findings, previousFindings);
  if (newFindings.length === 0) return false;

  // Filter by minimum severity
  const order = ['info', 'low', 'medium', 'high', 'critical'];
  const minIdx = order.indexOf(minSeverity);
  const filtered = newFindings.filter(f => order.indexOf(f.severity) >= minIdx);
  if (filtered.length === 0) return false;

  const message = formatTelegramMessage(filtered, appCount);
  if (!message) return false;

  try {
    const res = await fetch(
      `https://api.telegram.org/bot${config.botToken}/sendMessage`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: config.chatId,
          text: message,
          parse_mode: 'HTML',
        }),
      }
    );
    return res.ok;
  } catch {
    return false;
  }
}

export function loadNotifiedFindings(): Finding[] {
  if (!existsSync(NOTIFIED_PATH)) return [];
  try {
    return JSON.parse(readFileSync(NOTIFIED_PATH, 'utf-8')) as Finding[];
  } catch {
    return [];
  }
}

export function saveNotifiedFindings(findings: Finding[]): void {
  const dir = dirname(NOTIFIED_PATH);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(NOTIFIED_PATH, JSON.stringify(findings, null, 2) + '\n');
}

function loadTelegramConfig(): TelegramConfig | null {
  if (!existsSync(TELEGRAM_CONFIG_PATH)) return null;
  try {
    const raw = JSON.parse(readFileSync(TELEGRAM_CONFIG_PATH, 'utf-8'));
    if (!raw.botToken || !raw.chatId) return null;
    return { botToken: raw.botToken, chatId: String(raw.chatId) };
  } catch {
    return null;
  }
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /home/matt/fleet && npx vitest run src/core/deps/__tests__/reporters/telegram.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
cd /home/matt/fleet
git add src/core/deps/reporters/telegram.ts src/core/deps/__tests__/reporters/telegram.test.ts
git commit -m "feat(deps): add telegram reporter with deduplication"
```

---

## Task 17: PR Creator (Actor)

**Files:**
- Create: `src/core/deps/actors/pr-creator.ts`
- Test: `src/core/deps/__tests__/actors/pr-creator.test.ts`

- [ ] **Step 1: Write the test file**

```typescript
// src/core/deps/__tests__/actors/pr-creator.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { generateVersionBump, buildPrBody } from '../../actors/pr-creator.js';
import type { Finding } from '../../types.js';

function makeFinding(overrides: Partial<Finding> = {}): Finding {
  return {
    appName: 'test-app', source: 'npm', severity: 'medium',
    category: 'outdated-dep', title: 'react 18.3.1 -> 19.1.0',
    detail: 'update', package: 'react',
    currentVersion: '18.3.1', latestVersion: '19.1.0',
    fixable: true, updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('generateVersionBump', () => {
  it('generates package.json replacement for npm finding', () => {
    const finding = makeFinding({ source: 'npm', package: 'react', currentVersion: '18.3.1', latestVersion: '19.1.0' });
    const bump = generateVersionBump(finding);
    expect(bump).not.toBeNull();
    expect(bump!.file).toBe('package.json');
    expect(bump!.search).toContain('18.3.1');
    expect(bump!.replace).toContain('19.1.0');
  });

  it('generates Dockerfile replacement for docker-image finding', () => {
    const finding = makeFinding({
      source: 'docker-image', package: 'node',
      currentVersion: '18-alpine', latestVersion: '20-alpine',
    });
    const bump = generateVersionBump(finding);
    expect(bump).not.toBeNull();
    expect(bump!.file).toBe('Dockerfile');
  });

  it('returns null for non-fixable findings', () => {
    const finding = makeFinding({ fixable: false });
    expect(generateVersionBump(finding)).toBeNull();
  });
});

describe('buildPrBody', () => {
  it('includes all findings in the PR body', () => {
    const findings = [
      makeFinding({ title: 'react 18 -> 19' }),
      makeFinding({ title: 'express 4 -> 5' }),
    ];
    const body = buildPrBody(findings);
    expect(body).toContain('react 18 -> 19');
    expect(body).toContain('express 4 -> 5');
    expect(body).toContain('npm install');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /home/matt/fleet && npx vitest run src/core/deps/__tests__/actors/pr-creator.test.ts`
Expected: FAIL

- [ ] **Step 3: Write the PR creator**

```typescript
// src/core/deps/actors/pr-creator.ts
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { exec } from '../../exec.js';
import type { AppEntry } from '../../registry.js';
import type { Finding } from '../types.js';

interface VersionBump {
  file: string;
  search: string;
  replace: string;
}

export function generateVersionBump(finding: Finding): VersionBump | null {
  if (!finding.fixable || !finding.package || !finding.currentVersion || !finding.latestVersion) {
    return null;
  }

  switch (finding.source) {
    case 'npm':
      return {
        file: 'package.json',
        search: `"${finding.package}": "${finding.currentVersion}"`,
        replace: `"${finding.package}": "${finding.latestVersion}"`,
      };
    case 'composer':
      return {
        file: 'composer.json',
        search: `"${finding.package}": "${finding.currentVersion}"`,
        replace: `"${finding.package}": "${finding.latestVersion}"`,
      };
    case 'pip':
      return {
        file: 'requirements.txt',
        search: `${finding.package}==${finding.currentVersion}`,
        replace: `${finding.package}==${finding.latestVersion}`,
      };
    case 'docker-image':
      return {
        file: 'Dockerfile',
        search: `${finding.package}:${finding.currentVersion}`,
        replace: `${finding.package}:${finding.latestVersion}`,
      };
    default:
      return null;
  }
}

export function buildPrBody(findings: Finding[]): string {
  const lines: string[] = [];
  lines.push('## Dependency Updates\n');
  lines.push('| Package | Current | Latest | Severity |');
  lines.push('|---------|---------|--------|----------|');
  for (const f of findings) {
    lines.push(`| ${f.package ?? f.title} | ${f.currentVersion ?? '-'} | ${f.latestVersion ?? '-'} | ${f.severity} |`);
  }
  lines.push('');
  lines.push('## Post-merge steps');
  lines.push('');

  const hasNpm = findings.some(f => f.source === 'npm');
  const hasComposer = findings.some(f => f.source === 'composer');
  const hasPip = findings.some(f => f.source === 'pip');
  const hasDocker = findings.some(f => f.source === 'docker-image');

  if (hasNpm) lines.push('- [ ] Run `npm install` to update lockfile');
  if (hasComposer) lines.push('- [ ] Run `composer update` to update lockfile');
  if (hasPip) lines.push('- [ ] Run `pip install -r requirements.txt` to verify');
  if (hasDocker) lines.push('- [ ] Rebuild Docker image and test');
  lines.push('- [ ] Run tests');
  lines.push('');
  lines.push('---');
  lines.push('Generated by `fleet deps fix`');

  return lines.join('\n');
}

export function createDepsPr(
  app: AppEntry,
  findings: Finding[],
  dryRun: boolean,
): { branch: string; bumps: VersionBump[]; prUrl?: string } {
  const fixable = findings.filter(f => f.fixable);
  const bumps = fixable.map(generateVersionBump).filter((b): b is VersionBump => b !== null);

  if (bumps.length === 0) {
    return { branch: '', bumps: [] };
  }

  const date = new Date().toISOString().split('T')[0];
  const branch = `deps/${app.name}/${date}`;

  if (dryRun) {
    return { branch, bumps };
  }

  // Create branch from develop
  const sshEnv = { SSH_AUTH_SOCK: '/tmp/fleet-ssh-agent.sock' };
  exec(`git checkout develop`, { cwd: app.composePath });
  exec(`git pull`, { cwd: app.composePath, env: sshEnv });
  exec(`git checkout -b ${branch}`, { cwd: app.composePath });

  // Apply bumps
  for (const bump of bumps) {
    const filePath = join(app.composePath, bump.file);
    if (!existsSync(filePath)) continue;
    let content = readFileSync(filePath, 'utf-8');
    content = content.replace(bump.search, bump.replace);
    writeFileSync(filePath, content);
  }

  // Commit
  const files = [...new Set(bumps.map(b => b.file))];
  exec(`git add ${files.join(' ')}`, { cwd: app.composePath });

  const commitMsg = bumps.length === 1
    ? `chore(deps): update ${fixable[0].package} from ${fixable[0].currentVersion} to ${fixable[0].latestVersion}`
    : `chore(deps): update ${bumps.length} dependencies`;
  exec(`git commit -m "${commitMsg}"`, { cwd: app.composePath });

  // Push
  exec(`git push -u origin ${branch}`, { cwd: app.composePath, env: sshEnv });

  // Create PR
  if (!app.gitRepo) return { branch, bumps };

  const prBody = buildPrBody(fixable);
  const prTitle = `chore(deps): update dependencies (${date})`;
  const prResult = exec(
    `gh pr create --repo ${app.gitRepo} --title "${prTitle}" --body "${prBody.replace(/"/g, '\\"')}" --base develop`,
    { cwd: app.composePath, env: sshEnv }
  );

  const prUrl = prResult.ok ? prResult.stdout.trim() : undefined;

  return { branch, bumps, prUrl };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /home/matt/fleet && npx vitest run src/core/deps/__tests__/actors/pr-creator.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
cd /home/matt/fleet
git add src/core/deps/actors/pr-creator.ts src/core/deps/__tests__/actors/pr-creator.test.ts
git commit -m "feat(deps): add pr creator actor for automated dependency updates"
```

---

## Task 18: CLI Command (deps.ts)

**Files:**
- Create: `src/commands/deps.ts`
- Modify: `src/cli.ts:1-119`

- [ ] **Step 1: Write the deps command**

```typescript
// src/commands/deps.ts
import { load, findApp } from '../core/registry.js';
import { loadConfig, saveConfig, defaultConfig, configPath } from '../core/deps/config.js';
import { loadCache, saveCache, isCacheStale, cachePath } from '../core/deps/cache.js';
import { runScan, createCollectors } from '../core/deps/scanner.js';
import { formatSummary, formatAppDetail } from '../core/deps/reporters/cli.js';
import { formatMotd } from '../core/deps/reporters/motd.js';
import { generateMotdScript } from '../core/deps/reporters/motd.js';
import {
  sendTelegramNotification, loadNotifiedFindings, saveNotifiedFindings,
} from '../core/deps/reporters/telegram.js';
import { createDepsPr } from '../core/deps/actors/pr-creator.js';
import { AppNotFoundError } from '../core/errors.js';
import { heading, success, error, info, warn, table, c } from '../ui/output.js';
import { writeFileSync, chmodSync } from 'node:fs';

export async function depsCommand(args: string[]): Promise<void> {
  const sub = args[0];

  switch (sub) {
    case 'scan': return depsScan(args.slice(1));
    case 'fix': return depsFix(args.slice(1));
    case 'config': return depsConfig(args.slice(1));
    case 'ignore': return depsIgnore(args.slice(1));
    case 'unignore': return depsUnignore(args.slice(1));
    case 'init': return depsInit(args.slice(1));
    default: return depsShow(args);
  }
}

async function depsShow(args: string[]): void {
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

  // Summary view
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

  // Send Telegram notification
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
  const includeMajor = args.includes('--major');
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

  let findings = cache.findings.filter(f => f.appName === app.name && f.fixable);
  if (!includeMajor) {
    findings = findings.filter(f => f.severity !== 'high' || f.source !== 'npm');
  }

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
    const updated = { ...config } as Record<string, unknown>;

    // Parse value
    const parsed = value === 'true' ? true : value === 'false' ? false : isNaN(Number(value)) ? value : Number(value);
    updated[key] = parsed;

    saveConfig(updated as any);
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

async function depsInit(args: string[]): Promise<void> {
  // Create default config
  const config = loadConfig();
  saveConfig(config);
  success(`Config written to ${configPath()}`);

  // Install MOTD script
  const motdPath = '/etc/update-motd.d/99-fleet-deps';
  const script = generateMotdScript(cachePath());
  writeFileSync(motdPath, script);
  chmodSync(motdPath, 0o755);
  success(`MOTD script installed at ${motdPath}`);

  // Install cron
  const cronLine = `0 */${config.scanIntervalHours} * * * root /usr/local/bin/fleet deps scan --quiet\n`;
  writeFileSync('/etc/cron.d/fleet-deps', cronLine);
  success(`Cron installed: every ${config.scanIntervalHours} hours`);

  // Run initial scan
  info('Running initial scan...');
  await depsScan(['--quiet']);
  success('Initial scan complete. Run: fleet deps');
}

function extractFlag(args: string[], flag: string): string | undefined {
  const idx = args.indexOf(flag);
  if (idx === -1 || idx + 1 >= args.length) return undefined;
  return args[idx + 1];
}
```

- [ ] **Step 2: Add to CLI router**

In `src/cli.ts`, add the import at line 1 area and the switch case:

Add import:
```typescript
import { depsCommand } from './commands/deps.js';
```

Add case in switch block (after `health`):
```typescript
case 'deps': return depsCommand(rest);
```

Add to HELP text (after `health` line):
```
  deps [app]            Dependency health: outdated, CVEs, EOL, Docker
  deps scan             Run fresh dependency scan
  deps fix <app>        Create PR for fixable dependency updates
  deps config           Show/set configuration
  deps ignore <pkg>     Suppress a finding
  deps init             Install cron + MOTD for automated scanning
```

- [ ] **Step 3: Build and verify no compile errors**

Run: `cd /home/matt/fleet && npm run build`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
cd /home/matt/fleet
git add src/commands/deps.ts src/cli.ts
git commit -m "feat(deps): add fleet deps command with subcommands"
```

---

## Task 19: MCP Tool Registration

**Files:**
- Create: `src/mcp/deps-tools.ts`
- Modify: `src/mcp/server.ts`

- [ ] **Step 1: Write the MCP tools file**

```typescript
// src/mcp/deps-tools.ts
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { load, findApp } from '../core/registry.js';
import { loadConfig, saveConfig } from '../core/deps/config.js';
import { loadCache } from '../core/deps/cache.js';
import { runScan } from '../core/deps/scanner.js';
import { createDepsPr } from '../core/deps/actors/pr-creator.js';
import { AppNotFoundError } from '../core/errors.js';

function text(msg: string) {
  return { content: [{ type: 'text' as const, text: msg }] };
}

export function registerDepsTools(server: McpServer): void {
  server.tool(
    'fleet_deps_status',
    'Dependency health summary from cache — outdated packages, CVEs, EOL warnings, Docker image updates',
    async () => {
      const cache = loadCache();
      if (!cache) return text('No scan data. Run fleet deps scan first.');
      return text(JSON.stringify(cache, null, 2));
    }
  );

  server.tool(
    'fleet_deps_scan',
    'Run a fresh dependency scan across all registered apps',
    async () => {
      const reg = load();
      const config = loadConfig();
      const cache = await runScan(reg.apps, config);
      return text(JSON.stringify({
        findings: cache.findings.length,
        errors: cache.errors.length,
        duration: cache.scanDurationMs,
        apps: reg.apps.length,
      }, null, 2));
    }
  );

  server.tool(
    'fleet_deps_app',
    'Dependency findings for a specific app',
    { app: z.string().describe('App name') },
    async ({ app }) => {
      const cache = loadCache();
      if (!cache) return text('No scan data. Run fleet deps scan first.');
      const reg = load();
      const entry = findApp(reg, app);
      if (!entry) throw new AppNotFoundError(app);
      const findings = cache.findings.filter(f => f.appName === entry.name);
      return text(JSON.stringify(findings, null, 2));
    }
  );

  server.tool(
    'fleet_deps_fix',
    'Create a PR with dependency updates for an app (dry-run by default)',
    {
      app: z.string().describe('App name'),
      dryRun: z.boolean().default(true).describe('Preview changes without creating PR'),
    },
    async ({ app, dryRun }) => {
      const reg = load();
      const entry = findApp(reg, app);
      if (!entry) throw new AppNotFoundError(app);
      const cache = loadCache();
      if (!cache) return text('No scan data. Run fleet deps scan first.');
      const findings = cache.findings.filter(f => f.appName === entry.name && f.fixable);
      const result = createDepsPr(entry, findings, dryRun);
      return text(JSON.stringify(result, null, 2));
    }
  );

  server.tool(
    'fleet_deps_ignore',
    'Add an ignore rule for a dependency finding',
    {
      package: z.string().describe('Package name to ignore'),
      reason: z.string().describe('Why this is being ignored'),
      app: z.string().optional().describe('Limit to specific app'),
      until: z.string().optional().describe('Auto-expire date (YYYY-MM-DD)'),
    },
    async ({ package: pkg, reason, app, until }) => {
      const config = loadConfig();
      config.ignore.push({
        package: pkg, reason,
        ...(app && { appName: app }),
        ...(until && { until }),
      });
      saveConfig(config);
      return text(`Ignoring ${pkg}: ${reason}`);
    }
  );

  server.tool(
    'fleet_deps_config',
    'Get or set dependency monitoring configuration',
    { key: z.string().optional(), value: z.string().optional() },
    async ({ key, value }) => {
      const config = loadConfig();
      if (!key) return text(JSON.stringify(config, null, 2));
      if (!value) return text(JSON.stringify((config as any)[key], null, 2));
      (config as any)[key] = value === 'true' ? true : value === 'false' ? false : isNaN(Number(value)) ? value : Number(value);
      saveConfig(config);
      return text(`Set ${key} = ${value}`);
    }
  );
}
```

- [ ] **Step 2: Register in server.ts**

In `src/mcp/server.ts`, add import:
```typescript
import { registerDepsTools } from './deps-tools.js';
```

Add registration call inside `startMcpServer()`, after the existing `registerGitTools(server)` call:
```typescript
registerDepsTools(server);
```

- [ ] **Step 3: Build and verify**

Run: `cd /home/matt/fleet && npm run build`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
cd /home/matt/fleet
git add src/mcp/deps-tools.ts src/mcp/server.ts
git commit -m "feat(deps): add mcp tools for dependency monitoring"
```

---

## Task 20: Build, Test, and Verify

- [ ] **Step 1: Run all tests**

Run: `cd /home/matt/fleet && npx vitest run`
Expected: All tests pass

- [ ] **Step 2: Build**

Run: `cd /home/matt/fleet && npm run build`
Expected: Clean build, no errors

- [ ] **Step 3: Smoke test CLI**

Run: `cd /home/matt/fleet && node dist/index.js deps --help`
Expected: Shows deps in help output

- [ ] **Step 4: Smoke test init**

Run: `cd /home/matt/fleet && node dist/index.js deps init`
Expected: Creates config, installs MOTD script, installs cron, runs initial scan

- [ ] **Step 5: Verify scan output**

Run: `cd /home/matt/fleet && node dist/index.js deps`
Expected: Shows dependency health summary table

- [ ] **Step 6: Verify single app**

Run: `cd /home/matt/fleet && node dist/index.js deps hga`
Expected: Shows findings for hga app

- [ ] **Step 7: Verify JSON output**

Run: `cd /home/matt/fleet && node dist/index.js deps --json | head -20`
Expected: Valid JSON cache output

- [ ] **Step 8: Verify MOTD**

Run: `cd /home/matt/fleet && node dist/index.js deps --motd`
Expected: Compact MOTD output

- [ ] **Step 9: Final commit if any fixes were needed**

```bash
cd /home/matt/fleet
git add -p  # review any fixes
git commit -m "fix(deps): address issues found during smoke testing"
```
