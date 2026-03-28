# Fleet Deps — Dependency Health Monitor

**Date:** 2026-03-28
**Status:** Design approved

## Overview

A dependency health monitoring system for Fleet that scans all registered apps for outdated packages, Docker image updates, EOL warnings, security vulnerabilities, and open GitHub PRs. Surfaces findings via CLI, MOTD, and Telegram notifications. Can create PRs for fixable findings.

## Architecture

Pipeline architecture with four stages:

```
Collectors → Cache → Reporters → Actors
```

- **Collectors** gather findings from external APIs and local files
- **Cache** stores findings as JSON, read by everything downstream
- **Reporters** render findings to CLI, MOTD, Telegram, or JSON
- **Actors** create GitHub PRs for fixable findings

Each stage is independent and testable. Collector failures don't affect other collectors or downstream stages.

## Data Model

### Finding

```typescript
interface Finding {
  appName: string;
  source: CollectorType;
  severity: 'critical' | 'high' | 'medium' | 'low' | 'info';
  category: 'outdated-dep' | 'image-update' | 'eol-warning' | 'vulnerability' | 'pending-pr';
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

type CollectorType = 'npm' | 'composer' | 'pip' | 'docker-image' | 'docker-running' | 'eol' | 'vulnerability' | 'github-pr';
```

### Cache

```typescript
interface DepsCache {
  version: 1;
  lastScan: string;
  scanDurationMs: number;
  findings: Finding[];
  errors: ScanError[];
  config: DepsConfig;
}

interface ScanError {
  collector: CollectorType;
  appName?: string;
  message: string;
  timestamp: string;
}
```

### Severity Assignment

| Severity | Criteria |
|----------|----------|
| critical | CVE CVSS >= 9, EOL already passed |
| high     | CVE CVSS 7-8.9, EOL within 30 days, major version behind |
| medium   | Minor version behind, EOL within 90 days, base image update available |
| low      | Patch version behind |
| info     | Open GitHub PRs, informational notices |

## Collectors

Each collector implements:

```typescript
interface Collector {
  type: CollectorType;
  detect(appPath: string): boolean;
  collect(app: AppEntry): Promise<Finding[]>;
}
```

### 1. NpmCollector

- **Detects:** `package.json` in app's compose path
- **Queries:** npm registry (`https://registry.npmjs.org/{pkg}/latest`)
- **Produces:** `outdated-dep` findings with semver delta severity

### 2. ComposerCollector

- **Detects:** `composer.json` in app's compose path
- **Queries:** Packagist API (`https://repo.packagist.org/p2/{vendor}/{package}.json`)
- **Produces:** `outdated-dep` findings

### 3. PipCollector

- **Detects:** `requirements.txt` or `pyproject.toml` in app's compose path
- **Queries:** PyPI API (`https://pypi.org/pypi/{package}/json`)
- **Produces:** `outdated-dep` findings

### 4. DockerImageCollector

- **Detects:** `Dockerfile` or `image:` directives in compose files
- **Parses:** `FROM` lines in Dockerfiles, `image:` in compose YAML
- **Queries:** Docker Hub API (`https://hub.docker.com/v2/repositories/{namespace}/{repo}/tags`) or other registries
- **Produces:** `image-update` findings comparing semver tags

### 5. DockerRunningCollector

- **Detects:** Apps with running containers
- **Queries:** `docker inspect` for actual image digests/tags
- **Produces:** `image-update` findings for drift between running image and Dockerfile/compose spec, and for newer versions available on registry

### 6. EolCollector

- **Detects:** Runtime versions from `package.json` engines, `.nvmrc`, `composer.json`, `pyproject.toml`, and Dockerfile `FROM` tags (e.g. `node:18`)
- **Queries:** endoflife.date API (`https://endoflife.date/api/{product}/{version}.json`)
- **Produces:** `eol-warning` findings with date-based severity

### 7. VulnerabilityCollector

- **Detects:** Same manifest files as the package collectors
- **Queries:** npm audit endpoint (`/-/npm/v1/security/advisories/bulk`), OSV API (`https://api.osv.dev/v1/query`) for pip, Packagist/FriendsOfPHP security advisories for composer
- **Produces:** `vulnerability` findings with CVSS-based severity

### 8. GitHubPrCollector

- **Detects:** Apps with `gitRepo` set in registry
- **Queries:** `gh pr list --json` for open dependency-related PRs
- **Produces:** `pending-pr` findings with info severity

### Concurrency

Collectors run in parallel across apps with a configurable concurrency limit (default: 5). Each collector has per-registry rate limiting. If one collector fails, it logs to `errors[]` and the rest continue.

## Cache Layer

**Location:** `/home/matt/fleet/data/deps-cache.json`

- Written atomically (write to `.tmp` then rename)
- CLI checks `lastScan` and warns if stale (older than configured interval)
- Per-finding `updatedAt` timestamps — if a collector fails on re-scan, its old findings are preserved rather than wiped
- Findings older than 48 hours flagged as potentially stale

## Reporters

### 1. CLI Reporter

Primary interface via `fleet deps`.

**Summary view (default):**
```
--- Dependency Health (31 apps, scanned 2h ago) ---

  App                  Score    Critical  High  Medium  Low
  hga                  ##___    1         3     12      8
  zmb                  ####_    0         0     2       5
  abmanandvan          ###__    0         2     6       3
  leelas-ladybirds     #####    0         0     0       1

--- Critical (1) ------------------------------------------
  hga: lodash 4.17.15 -- CVE-2024-XXXXX (CVSS 9.1)

--- High (5) ----------------------------------------------
  hga: Node 18.19.0 -- EOL in 12 days (2026-04-09)
  abmanandvan: express 4.18.2 -> 5.1.0 (major behind)
```

**Commands:**
- `fleet deps` — summary from cache
- `fleet deps scan` — force fresh scan then display
- `fleet deps scan --now` — alias for above
- `fleet deps <app-name>` — detail view for one app
- `fleet deps --json` — full cache as JSON
- `fleet deps --severity critical,high` — filter by severity
- `fleet deps fix <app-name>` — create PR(s) for fixable findings

### 2. MOTD Reporter

Script at `/etc/update-motd.d/99-fleet-deps`. Reads cache, outputs max ~10 lines:

```
-- Fleet Deps -----------------------------------------
  3 critical findings across 31 apps
  hga: CVE-2024-XXXXX (lodash), Node 18 EOL in 12 days
  abmanandvan: 2 major versions behind
  14 apps fully up to date
  Last scan: 2h ago | Run: fleet deps
```

### 3. Telegram Reporter

Sends Telegram messages directly via the Telegram Bot API (`https://api.telegram.org/bot{token}/sendMessage`) using the same bot token and chat ID from the existing Fleet bot config at `/home/matt/fleet/bot/config/`. This avoids coupling to the Go bot process — the Node.js scanner just POSTs to Telegram. Sends one grouped message per scan with new/escalated findings only.

**Deduplication:** Tracks previously notified findings in `/home/matt/fleet/data/notified-findings.json`. Only sends:
- New findings not previously seen
- Findings that escalated in severity (e.g. EOL moved from medium to high)

### 4. JSON Reporter

Covered by `fleet deps --json` flag. Full cache output for scripting or future web dashboard.

## Actor Layer (PR Creation)

Triggered by `fleet deps fix <app-name>`.

### What's fixable

- Patch/minor version bumps in `package.json`, `composer.json`, `requirements.txt`
- Major version bumps with `--major` flag (not by default)
- Dockerfile `FROM` tag updates
- Vulnerability fixes where the fix is "upgrade to version Y"

### What's NOT fixable

- EOL warnings (require migration)
- Packages pinned for a known reason (via ignore rules)
- Anything requiring code changes beyond version strings

### PR workflow

1. Create branch `deps/<app-name>/<date>` from `develop`
2. Apply version changes to manifest files
3. Commit: `chore(deps): update X from A to B`
4. Push and create PR targeting `develop` via `gh pr create`
5. One PR per app, batching all fixable findings

### Safety

- `--dry-run` shows what would change without creating anything
- Never touches lockfiles — PR description notes that install/update needs running
- Never auto-merges

## Configuration

**Location:** `/home/matt/fleet/data/deps-config.json`

```typescript
interface DepsConfig {
  scanIntervalHours: number;          // default: 6
  concurrency: number;                // default: 5
  notifications: {
    telegram: {
      enabled: boolean;               // default: true
      chatId: string;
      minSeverity: Severity;          // default: 'info'
    };
  };
  ignore: IgnoreRule[];
  severityOverrides: {
    eolDaysWarning: number;           // default: 90 (medium), 30 (high), 0 (critical)
    majorVersionBehind: Severity;     // default: 'high'
    minorVersionBehind: Severity;     // default: 'medium'
    patchVersionBehind: Severity;     // default: 'low'
  };
}

interface IgnoreRule {
  appName?: string;
  package?: string;
  source?: CollectorType;
  reason: string;
  until?: string;
}
```

**Management commands:**
- `fleet deps config` — show current config
- `fleet deps config set scanIntervalHours 12`
- `fleet deps ignore react --app hga --reason "waiting for ecosystem" --until 2026-06-01`
- `fleet deps unignore react --app hga`

Works out of the box with zero config — all defaults are sensible.

## Scheduler

Set up via `fleet deps init`:

1. Creates `/etc/cron.d/fleet-deps`: `0 */6 * * * root /usr/local/bin/fleet deps scan --quiet`
2. Installs MOTD script at `/etc/update-motd.d/99-fleet-deps`
3. Creates default `deps-config.json` if absent
4. Runs initial scan

**`--quiet` flag** suppresses CLI output — updates cache and sends Telegram notifications only.

**Scan flow:**
1. Load registry and config
2. For each app, detect applicable collectors
3. Run collectors in parallel (bounded by concurrency)
4. Merge findings, deduplicate, apply ignore rules, assign severities
5. Write cache atomically
6. Diff against previous cache for new/escalated findings
7. Send Telegram notification if anything new
8. Exit

## File Structure

New files in `/home/matt/fleet/src/`:

```
commands/deps.ts              — CLI command router (deps, deps scan, deps fix, etc.)
core/deps/
  types.ts                    — Finding, DepsCache, DepsConfig, Collector interfaces
  cache.ts                    — Read/write/atomic cache operations
  config.ts                   — Load/save/merge config, defaults
  scanner.ts                  — Orchestrates collectors, manages concurrency
  severity.ts                 — Severity assignment logic
  collectors/
    npm.ts
    composer.ts
    pip.ts
    docker-image.ts
    docker-running.ts
    eol.ts
    vulnerability.ts
    github-pr.ts
  reporters/
    cli.ts                    — Terminal table/detail output
    motd.ts                   — Compact MOTD output
    telegram.ts               — Telegram notification with dedup
  actors/
    pr-creator.ts             — Branch, commit, push, create PR
data/
  deps-cache.json             — Scan results (generated)
  deps-config.json            — User config (generated)
  notified-findings.json      — Telegram dedup state (generated)
mcp/deps-tools.ts             — MCP tool registrations
templates/motd-deps.ts        — MOTD script generator
```

## MCP Tools

Register in `src/mcp/deps-tools.ts`:

- `fleet_deps_status` — summary from cache (same as `fleet deps --json`)
- `fleet_deps_scan` — trigger a fresh scan
- `fleet_deps_app` — findings for a specific app
- `fleet_deps_fix` — create PR for an app (with dry-run default)
- `fleet_deps_ignore` — add an ignore rule
- `fleet_deps_config` — get/set configuration
