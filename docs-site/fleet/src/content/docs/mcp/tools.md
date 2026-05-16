---
title: MCP Tools Reference
description: Complete reference for all fleet MCP tools
---

All tools are exposed by the `fleet mcp` server. Parameters marked **required** must be provided; all others are optional.

---

## Fleet Management

### `fleet_status`

Dashboard data for all apps: systemd state, containers, health.

No parameters.

---

### `fleet_list`

List all registered apps with their configuration.

No parameters.

---

### `fleet_start`

Start an app via systemctl.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `app` | string | Yes | App name |

---

### `fleet_stop`

Stop an app via systemctl.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `app` | string | Yes | App name |

---

### `fleet_restart`

Restart an app via systemctl.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `app` | string | Yes | App name |

---

### `fleet_logs` *(deprecated)*

Get recent container logs. Marked deprecated in favour of the four token-conservative tools below — kept for backwards compatibility.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `app` | string | Yes | App name |
| `lines` | number | No | Number of log lines (default: 100) |

---

### `fleet_logs_summary`

Aggregate counts by level + top 10 distinct error/warn messages over a window. **Cheapest log tool** — your first pass before fetching raw text.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `app` | string | Yes | App name |
| `container` | string | No | Container name (defaults to first) |
| `sinceMinutes` | number | No | Window in minutes (default: 60) |

---

### `fleet_logs_recent`

Bounded tail with level / since / grep filters. Defaults are deliberately small.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `app` | string | Yes | App name |
| `container` | string | No | Container (defaults to first) |
| `lines` | number | No | Tail N lines (default: 50) |
| `level` | enum | No | `debug` / `info` / `warn` / `error` (default: `warn`) |
| `sinceMinutes` | number | No | Look back this many minutes (default: 15) |
| `grep` | string | No | Substring filter applied after level |

Output capped at 200 KB; appends a hint when truncated.

---

### `fleet_logs_search`

Bounded grep across recent logs. Returns matching lines, capped at `maxResults`.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `app` | string | Yes | App name |
| `container` | string | No | Container (defaults to first) |
| `query` | string | Yes | Substring or regex |
| `sinceMinutes` | number | No | Window in minutes (default: 60) |
| `maxResults` | number | No | Cap results (default: 20) |

---

### `fleet_logs_status`

Per-container driver, current size, and policy applied. Use to find apps still on docker defaults (unbounded).

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `app` | string | No | App name (omit for all) |

---

### `fleet_egress_snapshot`

Snapshot the current outbound TCP flows for an app and report which destinations aren't on the configured allowlist. Observe-only — never blocks traffic.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `app` | string | Yes | App name |

Returns `{ takenAt, uniqueRemotes, violations, flowCount }`.

---

### `fleet_health`

Run health checks for one or all apps.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `app` | string | No | App name. Omit for all apps. |

---

### `fleet_deploy`

Build and restart an app (runs `docker compose build` then restarts the systemd service).

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `app` | string | Yes | App name |

---

### `fleet_register`

Register a new app in the fleet registry.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `name` | string | Yes | App name (kebab-case identifier) |
| `composePath` | string | Yes | Absolute path to docker-compose directory |
| `displayName` | string | No | Human-friendly name |
| `composeFile` | string | No | Custom compose filename |
| `serviceName` | string | No | Systemd service name |
| `domains` | string[] | No | Domain names (default: `[]`) |
| `port` | number | No | Backend port |
| `type` | enum | No | App type: `proxy`, `spa`, `nextjs`, `service` (default: `service`) |
| `containers` | string[] | No | Container names (auto-detected if omitted) |
| `usesSharedDb` | boolean | No | Uses shared database (default: `false`) |
| `dependsOnDatabases` | boolean | No | Depends on docker-databases (default: `false`) |

---

### `fleet_freeze`

Freeze a crash-looping service: stop it, disable it, and mark it frozen in the registry.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `app` | string | Yes | App name |
| `reason` | string | No | Reason for freezing |

---

### `fleet_unfreeze`

Unfreeze a frozen service: clear frozen state, enable and start the service.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `app` | string | Yes | App name |

---

## Nginx

### `fleet_nginx_add`

Create an nginx config for a domain. Tests the config and reloads nginx if the test passes.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `domain` | string | Yes | Domain name |
| `port` | number | Yes | Backend port (must be 1024–65535, not a reserved DB port) |
| `type` | enum | No | `proxy`, `spa`, or `nextjs` (default: `proxy`) |

---

### `fleet_nginx_list`

List all nginx site configs.

No parameters.

---

## Secrets

### `fleet_secrets_status`

Show vault initialisation state, sealed/unsealed status, and key counts.

No parameters.

---

### `fleet_secrets_list`

List managed secrets for an app (masked values). Shows vault contents.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `app` | string | No | App name. Omit for all apps. |

---

### `fleet_secrets_set`

Set a single secret key/value for an app directly in the encrypted vault.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `app` | string | Yes | App name |
| `key` | string | Yes | Secret key name (e.g. `DATABASE_URL`) |
| `value` | string | Yes | Secret value |

---

### `fleet_secrets_get`

Get a single decrypted secret value from the vault.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `app` | string | Yes | App name |
| `key` | string | Yes | Secret key name |

---

### `fleet_secrets_unseal`

Decrypt vault to `/run/fleet-secrets/`. Overwrites any runtime changes not yet sealed.

No parameters.

---

### `fleet_secrets_seal`

Seal runtime secrets back to the encrypted vault. Creates an automatic backup before sealing.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `app` | string | No | App name. Omit to seal all apps. |

---

### `fleet_secrets_drift`

Detect drift between vault and runtime (`/run/fleet-secrets/`).

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `app` | string | No | App name. Omit to check all apps. |

---

### `fleet_secrets_validate`

Validate that compose secret references have matching entries in the vault.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `app` | string | No | App name. Omit for all apps. |

---

### `fleet_secrets_restore`

Restore vault from the automatic backup (`.bak` file).

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `app` | string | Yes | App name |

---

## Git

### `fleet_git_status`

Git state for one or all apps: branch, clean/dirty, onboard status.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `app` | string | No | App name. Omit for all apps. |

---

### `fleet_git_onboard`

Onboard an app to GitHub: create repo, push code, protect branches.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `app` | string | Yes | App name |
| `dryRun` | boolean | No | Preview without making changes (default: `false`) |

---

### `fleet_git_branch`

Create a feature branch from a base branch and push it.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `app` | string | Yes | App name |
| `branch` | string | Yes | New branch name |
| `from` | string | No | Base branch (default: `develop`) |
| `dryRun` | boolean | No | Preview without making changes (default: `false`) |

---

### `fleet_git_commit`

Stage tracked file changes and commit.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `app` | string | Yes | App name |
| `message` | string | Yes | Commit message |
| `dryRun` | boolean | No | Preview without making changes (default: `false`) |

---

### `fleet_git_push`

Push the current branch to origin.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `app` | string | Yes | App name |
| `dryRun` | boolean | No | Preview without making changes (default: `false`) |

---

### `fleet_git_pr_create`

Create a pull request on GitHub.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `app` | string | Yes | App name |
| `title` | string | Yes | PR title |
| `body` | string | No | PR description |
| `base` | string | No | Target branch (default: `develop`) |
| `dryRun` | boolean | No | Preview without making changes (default: `false`) |

---

### `fleet_git_pr_list`

List pull requests for an app.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `app` | string | Yes | App name |
| `state` | enum | No | `open`, `closed`, or `all` (default: `open`) |

---

### `fleet_git_release`

Create a release PR from `develop` to `main`.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `app` | string | Yes | App name |
| `title` | string | No | PR title (default: `Release: <app>`) |
| `dryRun` | boolean | No | Preview without making changes (default: `false`) |

---

## Dependencies

### `fleet_deps_status`

Dependency health summary from cache — outdated packages, CVEs, EOL warnings, Docker image updates.

No parameters.

---

### `fleet_deps_scan`

Run a fresh dependency scan across all registered apps.

No parameters.

---

### `fleet_deps_app`

Dependency findings for a specific app.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `app` | string | Yes | App name |

---

### `fleet_deps_fix`

Create a PR with dependency updates for an app.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `app` | string | Yes | App name |
| `dryRun` | boolean | No | Preview changes without creating PR (default: `true`) |

---

### `fleet_deps_ignore`

Add an ignore rule for a dependency finding.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `package` | string | Yes | Package name to ignore |
| `reason` | string | Yes | Why this is being ignored |
| `app` | string | No | Limit to a specific app |
| `until` | string | No | Auto-expire date (`YYYY-MM-DD`) |

---

### `fleet_deps_config`

Get or set dependency monitoring configuration.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `key` | string | No | Config key to read or set |
| `value` | string | No | New value (provide with `key` to set) |
