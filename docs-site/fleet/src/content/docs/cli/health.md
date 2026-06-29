---
title: Health
description: Run health checks against your fleet apps
---

---

## fleet health

Run health checks for one or all registered apps. Checks cover systemd unit state, container running status, and an optional HTTP endpoint.

### Usage

```bash
fleet health [app] [--json]
```

### Arguments

| Argument | Required | Description |
|----------|----------|-------------|
| `app` | No | App name. Omit to check all apps. |

### Flags

| Flag | Description |
|------|-------------|
| `--json` | Output raw JSON |

### Examples

Check all apps:

```bash
$ fleet health
Health Check

APP      SYSTEMD         CONTAINERS   HTTP       OVERALL
myapp    ✓ active        2/2          ✓ 200      ✓ healthy
api      ✓ active        1/1          ✓ 200      ✓ healthy
worker   ✗ failed        0/1          -          ✗ down
```

Check a single app:

```bash
$ fleet health myapp
Health: myapp
  Systemd:    ✓ active
  Container:  ✓ myapp-web-1 (healthy)
  Container:  ✓ myapp-db-1 (none)
  HTTP:       ✓ 200
  Overall:    healthy
```

JSON output:

```bash
$ fleet health myapp --json
{
  "app": "myapp",
  "systemd": { "ok": true, "state": "active" },
  "containers": [
    { "name": "myapp-web-1", "running": true, "health": "healthy" }
  ],
  "http": { "ok": true, "status": 200 },
  "overall": "healthy"
}
```

### HTTP health checks

An HTTP check is only performed if `healthPath` is set on the app's registry entry. To add it, use `fleet_register` from MCP or edit `data/registry.json` directly, setting `healthPath` to a path like `/healthz`.

### Related

- **MCP tool:** `fleet_health`

See [Logs](/cli/logs) for container log commands including single-app tail, multi-source aggregation, log setup, and status.
