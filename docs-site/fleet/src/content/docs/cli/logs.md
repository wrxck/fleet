---
title: Logs
description: Tail container logs and configure per-app log lifecycle
---

Fleet wraps `docker logs` with filters, configures docker's json-file driver for rotation, and offers token-conservative MCP tools so AI agents can query logs without dumping the entire stream.

---

## fleet logs

Tail container logs for one app, or aggregate across many. Single-app mode defaults to the last 100 lines of the first container; multi-source mode (`--all` / `--apps` / `--containers`) prefixes every line with `app/container` and colour-codes by source.

### Single-app usage

```bash
fleet logs <app> [-f] [-n <lines>] [-c <container>] \
                 [--since <Nm|Nh|Nd>] [--grep <text>] [--level info|warn|error]
```

### Multi-source usage

```bash
fleet logs --all [-f]                              # every container, prefixed
fleet logs --apps macpool,shiftfaced [-f]          # subset by app
fleet logs --containers '*-postgres' [-f]          # glob match container names
fleet logs --all -f --grep error --level warn      # live filtered tail
fleet logs --all --tail 20                         # one-shot dump, 20 per source
```

Each source gets a stable colour assigned by name hash, so you can keep visual track of which is which without staring at the prefix. Ctrl-C tears down all child `docker logs -f` processes cleanly.

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

## TUI: multi-source logs view

Press `Tab` from the dashboard until you reach the **Logs** view (now part of the top-level cycle: dashboard → health → secrets → logs-multi → dashboard).

| Key | Action |
|---|---|
| `Tab` | Switch focus between source picker and logs viewport |
| `j` / `k` | Move selection cursor in the picker |
| `Space` | Toggle the selected source on/off (re-tail starts immediately) |
| `a` | Select all / deselect all sources |
| `p` | Pause output (lines keep buffering up to 500) |
| `c` | Clear the visible buffer |
| `L` | Cycle level filter: `all` → `debug` → `info` → `warn` → `error` |
| `q` | Quit |

Output is batched on a 100ms tick to avoid flicker during bursts. Each line shows `HH:MM:SS  app/container  message`.

## MCP tools

Every MCP log tool defaults small + returns a `truncated` flag when output is capped. Reach for `fleet_logs_summary` first — it's by far the cheapest.

| Tool | Defaults | Notes |
|------|----------|-------|
| `fleet_logs_summary(app, sinceMinutes=60)` | last 60 min | Counts by level + top 10 distinct error/warn messages with timestamps + IDs canonicalised. Tiny payload. |
| `fleet_logs_recent(app, lines=50, level='warn', sinceMinutes=15)` | small | Bounded tail, filtered. Cap 200 KB. |
| `fleet_logs_search(app, query, sinceMinutes=60, maxResults=20)` | bounded | Substring grep, reports overflow count. |
| `fleet_logs_status(app?)` | — | JSON: per-container driver + sizeMB + policy. |

The legacy `fleet_logs(app, container?, lines=100)` tool is kept for backwards compatibility but marked **DEPRECATED** in its description — prefer the four above.
