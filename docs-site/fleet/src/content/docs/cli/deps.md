---
title: Deps
description: Dependency scanning and update management
---

Fleet scans all registered apps for outdated packages (npm, Composer, pip), Docker image updates, runtime EOL warnings (via endoflife.date), and security vulnerabilities (via the OSV API). Results are cached and surfaced via the CLI, SSH MOTD, and Telegram notifications.

---

## fleet deps

Show a dependency health dashboard from cached scan results.

### Usage

```bash
fleet deps [app] [--json] [--severity <levels>] [--motd]
```

### Arguments

| Argument | Required | Description |
|----------|----------|-------------|
| `app` | No | App name for per-app detail. Omit for summary. |

### Flags

| Flag | Description |
|------|-------------|
| `--json` | Output raw JSON |
| `--severity <levels>` | Filter by comma-separated severity levels (e.g. `critical,high`) |
| `--motd` | Output MOTD-formatted text for SSH login banners |

### Examples

```bash
$ fleet deps
Dependency Health
...summary of findings across all apps...
```

```bash
$ fleet deps myapp
Deps: myapp
...per-app findings...
```

```bash
$ fleet deps --severity critical,high
```

If no scan data is present, fleet prompts you to run `fleet deps scan` first.

### Related

- **MCP tool:** `fleet_deps_status`

---

## fleet deps scan

Run a fresh dependency scan across all registered apps. Results are saved to a local cache.

### Usage

```bash
fleet deps scan [--quiet]
```

### Flags

| Flag | Description |
|------|-------------|
| `--quiet` | Suppress output (useful in cron jobs) |

### Examples

```bash
$ fleet deps scan
Scanning dependencies across all apps...
✓ Scan complete: 12 findings across 3 apps (4200ms)

Dependency Health
...
```

If Telegram notifications are configured, fleet sends an alert for any new findings above the configured minimum severity.

### Related

- **MCP tool:** `fleet_deps_scan`

---

## fleet deps fix

Create a pull request with dependency updates for an app. Dry-run by default.

### Usage

```bash
fleet deps fix <app> [--dry-run]
```

### Arguments

| Argument | Required | Description |
|----------|----------|-------------|
| `app` | Yes | App name |

### Flags

| Flag | Description |
|------|-------------|
| `--dry-run` | Preview the changes that would be made without creating a PR |

### Examples

```bash
$ fleet deps fix myapp --dry-run
Dry run: myapp
  Would create branch: deps/update-2026-04-12
    package.json: "express": "^4.18.0" -> "^4.21.0"
    package.json: "zod": "^3.20.0" -> "^3.24.0"
```

```bash
$ fleet deps fix myapp
✓ PR created: https://github.com/org/myapp/pull/55
```

### Related

- **MCP tool:** `fleet_deps_fix`

---

## fleet deps config

Show or set dependency monitoring configuration.

### Usage

```bash
fleet deps config [set <key> <value>]
```

### Configurable keys

| Key | Description |
|-----|-------------|
| `scanIntervalHours` | How often automated scans run (default: 6) |
| `concurrency` | Number of apps to scan in parallel |

### Examples

```bash
$ fleet deps config
{
  "scanIntervalHours": 6,
  "concurrency": 3,
  "ignore": [],
  ...
}
```

```bash
$ fleet deps config set scanIntervalHours 12
✓ Set scanIntervalHours = 12
```

### Related

- **MCP tool:** `fleet_deps_config`

---

## fleet deps ignore

Add an ignore rule to suppress a specific dependency finding.

### Usage

```bash
fleet deps ignore <package> --reason "..." [--app <name>] [--until YYYY-MM-DD]
```

### Arguments

| Argument | Required | Description |
|----------|----------|-------------|
| `package` | Yes | Package name to ignore |

### Flags

| Flag | Description |
|------|-------------|
| `--reason "..."` | Why this finding is being suppressed (required) |
| `--app <name>` | Limit the ignore rule to a specific app |
| `--until YYYY-MM-DD` | Auto-expire the rule on this date |

### Examples

```bash
$ fleet deps ignore lodash --reason "Internal use only, not exposed" --app myapp
✓ Ignoring lodash for myapp: Internal use only, not exposed
```

```bash
$ fleet deps ignore some-pkg --reason "False positive" --until 2026-06-01
✓ Ignoring some-pkg: False positive
```

### Related

- **MCP tool:** `fleet_deps_ignore`

---

## fleet deps init

Install automated dependency scanning: writes a cron job, installs a MOTD script for SSH login banners, and runs an initial scan.

### Usage

```bash
fleet deps init
```

### What it does

1. Writes config to `data/deps-config.json`
2. Installs `/etc/update-motd.d/99-fleet-deps` — displays a deps summary on SSH login
3. Installs `/etc/cron.d/fleet-deps` — runs `fleet deps scan --quiet` every `scanIntervalHours` hours
4. Runs an initial scan

### Examples

```bash
$ fleet deps init
✓ Config written to data/deps-config.json
✓ MOTD script installed at /etc/update-motd.d/99-fleet-deps
✓ Cron installed: every 6 hours
Running initial scan...
✓ Initial scan complete. Run: fleet deps
```
