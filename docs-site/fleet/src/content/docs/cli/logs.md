---
title: Logs
description: Tail container logs and configure per-app log lifecycle
---

Fleet wraps `docker logs` with filters, configures docker's json-file driver for rotation, and offers token-conservative MCP tools so AI agents can query logs without dumping the entire stream.

---

## fleet logs

Tail container logs, with optional filtering. Defaults to the last 100 lines of the first container.

### Usage

```bash
fleet logs <app> [-f] [-n <lines>] [-c <container>] \
                 [--since <Nm|Nh|Nd>] [--grep <text>] [--level info|warn|error]
```

### Flags

| Flag | Default | Description |
|------|---------|-------------|
| `-f`, `--follow` | off | Live tail (passes through to `docker logs -f`). |
| `-n <N>` | 100 | Number of trailing lines to show. |
| `-c <container>` | first | Pick a specific container in a multi-service app. |
| `--since <window>` | — | Only show entries within the given window (e.g. `30m`, `2h`, `1d`). |
| `--grep <text>` | — | Substring filter applied after `--level`. |
| `--level <level>` | — | Drop lines below this level (`debug` < `info` < `warn` < `error`). |

When `--level`, `--since`, or `--grep` is set in non-follow mode, output is capped at 200 KB; the tool warns if it had to truncate.

---

## fleet logs setup

Configure docker's json-file logging driver with rotation for one or every app. Writes a compose override to `<composePath>/.fleet/logging.override.yml`.

### Usage

```bash
fleet logs setup <app>           # interactive: retention/size/level
fleet logs setup --all           # bulk default policy (7 days / 100 MB / info)
fleet logs setup <app> -y        # accept defaults for one app, no prompt
```

### Per-app policy

Configured under `apps.<name>.logging` in `data/registry.json`:

```json
{
  "logging": { "retentionDays": 14, "maxSizeMB": 200, "level": "info" }
}
```

Defaults if unset: 7 days / 100 MB / `info`.

To activate the override, include it in your compose start command (or fleet's systemd unit):

```bash
docker compose -f docker-compose.yml -f .fleet/logging.override.yml up -d
```

---

## fleet logs status

Per-container size, driver, and whether the policy override file is present.

### Usage

```bash
fleet logs status [<app>] [--json]
```

### Example

```
Log status (3 containers)
  APP      CONTAINER  DRIVER     SIZE    POLICY        CONFIGURED
  macpool  macpool    json-file  12.4M   100M/7d/info  *
  ...
* = override file present, ! = using docker defaults (unbounded by default)
```

---

## fleet logs prune

Vacuum journald to the configured retention and truncate any json-file log over 5× the policy size cap (a heuristic that avoids racing with active writes).

### Usage

```bash
fleet logs prune <app> [-y]
```

---

## MCP tools

Every MCP log tool defaults small + returns a `truncated` flag when output is capped. Reach for `fleet_logs_summary` first — it's by far the cheapest.

| Tool | Defaults | Notes |
|------|----------|-------|
| `fleet_logs_summary(app, sinceMinutes=60)` | last 60 min | Counts by level + top 10 distinct error/warn messages with timestamps + IDs canonicalised. Tiny payload. |
| `fleet_logs_recent(app, lines=50, level='warn', sinceMinutes=15)` | small | Bounded tail, filtered. Cap 200 KB. |
| `fleet_logs_search(app, query, sinceMinutes=60, maxResults=20)` | bounded | Substring grep, reports overflow count. |
| `fleet_logs_status(app?)` | — | JSON: per-container driver + sizeMB + policy. |

The legacy `fleet_logs(app, container?, lines=100)` tool is kept for backwards compatibility but marked **DEPRECATED** in its description — prefer the four above.
