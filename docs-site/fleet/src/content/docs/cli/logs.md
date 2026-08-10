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
fleet logs --apps poolside,brewco [-f]          # subset by app
fleet logs --containers '*-postgres' [-f]          # glob match container names
fleet logs --all -f --grep error --level warn      # live filtered tail
fleet logs --all --tail 20                         # one-shot dump, 20 per source
```

Each source gets a stable colour assigned by name hash, so you can keep visual track of which is which without staring at the prefix. Ctrl-C tears down all child `docker logs -f` processes cleanly.

### Flags

| Flag | Default | Description |
|------|---------|-------------|
| `-f`, `--follow` | off | Live tail (passes through to `docker logs -f`). |
| `-n <N>`, `--tail <N>` | 100 | Number of trailing lines to show. `--tail` is an alias for `-n` accepted in both single-app and multi-source mode. |
| `-c <container>` | first | Pick a specific container in a multi-service app. |
| `--since <window>` | — | Only show entries within the given window (e.g. `30m`, `2h`, `1d`). |
| `--grep <text>` | — | Substring filter applied after `--level`. |
| `--level <level>` | — | Drop lines below this level (`debug` < `info` < `warn` < `error`). Applies in both single-app and multi-source mode. |

When `--level`, `--since`, or `--grep` is set in non-follow mode, output is capped at 200 KB; the tool warns if it had to truncate.

---

## Redaction

Secrets and PII are redacted on **every** log read path before the text reaches you: `fleet logs` (including `-f`), the TUI log views, and all `fleet_logs_*` MCP tools. Nothing needs enabling — it is on by default.

Matches become `[REDACTED:<category>#<fp>]`. The `#<fp>` suffix is four hex characters of a per-process salted hash, so the same secret appearing twice is visibly the same value within one output, while the fingerprint means nothing across runs and cannot be used to build a lookup table.

### Categories

| Category | Default | What it catches |
|---|---|---|
| `private_key` | on | `-----BEGIN … PRIVATE KEY-----` blocks, whole block |
| `jwt` | on | three base64url segments whose header decodes to JSON with an `alg` |
| `aws_key` | on | `AKIA`/`ASIA`/`ABIA`/`ACCA` + 16 uppercase alnum |
| `aws_secret` | on | 40-char secret, **only** when adjacent to an `aws_*_key` name |
| `provider_token` | on | `ghp_`, `github_pat_`, `xox[baprse]-`, `sk_live_`/`rk_live_`, `AIza`, `sk-ant-`, `sk-proj-`, `glpat-`, `npm_` |
| `auth_header` | on | `Authorization:` values, bare `Bearer`/`Basic` credentials |
| `uri_credentials` | on | the password in `scheme://user:password@host` — scheme, user and host are kept |
| `generic_assignment` | on | the value of a key ending in `PASSWORD`/`SECRET`/`TOKEN`/`API_KEY`/`CLIENT_SECRET`/`DSN`/… — the key name is kept |
| `iban` | on | mod-97 validated IBANs |
| `credit_card` | on | Luhn-valid numbers with a real network prefix |
| `uk_nino` | on | UK National Insurance numbers |
| `email` | on | email addresses |
| `phone` | **off** | digit runs have no checksum to validate against, and logs are full of them (ports, PIDs, epochs) |
| `ip` | **off** | operators need them to debug. When enabled, loopback / RFC1918 / CGNAT / link-local / documentation ranges are still never redacted |

### No false positives

The overriding design rule is that over-redaction is worse than under-redaction — unreadable logs defeat the point of `fleet logs`. No pattern fires on entropy alone; each is anchored on a vendor literal, gated on a key name meaning "secret", or structurally validated (Luhn, mod-97, base64 decode, octet ranges).

These all pass through untouched, each with a regression test: commit SHAs, UUIDs, `sha256:` digests, semver, ISO timestamps, epoch millis, file paths, credential-free URLs, ports, PIDs, byte counts, hex colours, Stripe *publishable* keys (`pk_live_`/`pk_test_`), SSH *public* keys, image data URIs, and prose such as `Invalid password supplied`.

### Filter ordering

`--grep` and `--level` match the **raw** line; redaction is applied to the survivors. Grepping for a hostname, account id or customer email therefore still returns the lines you need rather than silently returning nothing.

The trade-off: because matching happens pre-redaction, grepping a literal secret *value* reveals whether it appears in the log — you get back a line containing a placeholder. That is an oracle, not a disclosure. Set `redaction.enabled: false` for the app if you want neither.

### Per-app configuration

Lives under `logging.redaction` in `data/registry.json`:

```jsonc
{
  "name": "poolside",
  "logging": {
    "redaction": {
      "enabled": true,
      "categories": { "ip": true, "email": false },
      "customPatterns": [{ "name": "employee_id", "pattern": "EMP-\\d{6}" }],
      "allowlist": ["ops@fleet.internal", "/status-[0-9]+/"]
    }
  }
}
```

`allowlist` wins over everything, built-in and custom alike — it is the escape hatch when a false positive appears in production. Entries are literal strings, or `/regex/flags`.

`customPatterns` redact capture group 1 when present, otherwise the whole match. They are screened for ReDoS shapes at load, capped at 32 patterns of 1000 characters, skipped on lines over 4096 characters, and never allowed to throw — a bad pattern is skipped with a warning and `fleet logs` keeps working.

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
  poolside  poolside    json-file  12.4M   100M/7d/info  *
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
