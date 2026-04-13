---
title: Dependency Scanning
description: Automated dependency health checks, vulnerability detection, and updates
---

import { Aside } from '@astrojs/starlight/components';

Fleet includes a dependency scanner that checks your apps for outdated packages, known vulnerabilities, end-of-life runtimes, and pending pull requests.

## Collectors

The scanner runs eight collectors in parallel:

| Collector | What it checks |
|-----------|---------------|
| **npm** | `npm audit` and `npm outdated` |
| **Composer** | `composer audit` for PHP dependencies |
| **pip** | `pip-audit` for Python packages |
| **Docker Image** | Image age and available updates |
| **Docker Running** | Running container image freshness |
| **EOL** | Runtime end-of-life dates (Node, PHP, Python) |
| **Vulnerability** | Cross-references CVE databases |
| **GitHub PR** | Open Dependabot / Renovate pull requests |

Each collector implements a `detect(composePath)` method — it only runs if the app uses the relevant technology. For example, the npm collector only runs if `package.json` exists in the compose directory.

## Running a scan

```bash
# Scan all registered apps
sudo fleet deps scan

# Scan a specific app
sudo fleet deps scan myapp

# Show current status from cache
fleet deps status
```

## Configuration

Fleet reads deps config from `data/deps-config.json`:

```json
{
  "concurrency": 4,
  "severityOverrides": {
    "npmAuditMinSeverity": "moderate",
    "eolDaysWarning": 180
  },
  "ignore": ["CVE-2024-XXXX"],
  "schedule": "daily"
}
```

### Ignoring findings

```bash
# Ignore a specific finding
fleet deps ignore CVE-2024-12345

# View ignored findings
fleet deps status --show-ignored
```

## Severity levels

Findings are classified as: **critical**, **high**, **moderate**, **low**, **info**.

Severity overrides in the config let you adjust thresholds per collector. For example, `eolDaysWarning: 180` means a runtime within 180 days of EOL triggers a warning.

## Cache

Scan results are cached in `data/deps-cache.json` with timestamps. The `deps status` command reads from cache without re-running collectors. The cache includes:

- Findings with severity, source, and description
- Scan errors (if a collector failed)
- Scan duration and timestamp

## Reporters

Results can be output through three reporters:

- **CLI** — table output to the terminal
- **MOTD** — writes a summary to `/etc/motd` for SSH login banners
- **Telegram** — sends alerts via the fleet-bot

## Auto-fix

```bash
# Apply safe fixes (e.g., npm audit fix)
sudo fleet deps fix myapp
```

This runs the appropriate fix commands per package manager. Only non-breaking fixes are applied automatically.

<Aside type="caution">
The fix command runs package manager commands that modify `node_modules`, `composer.lock`, etc. Always review changes before committing.
</Aside>

## MCP integration

The `fleet_deps_scan` and `fleet_deps_status` MCP tools expose dependency scanning to Claude Code, enabling automated dependency management through natural language.
