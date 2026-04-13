---
title: Status
description: Check the status of your fleet apps
---

## fleet status

Show a dashboard of all registered apps with their systemd state, container counts, and health.

### Usage

```bash
fleet status [--json]
```

### Flags

| Flag | Description |
|------|-------------|
| `--json` | Output raw JSON instead of the formatted table |

### Examples

```bash
$ fleet status
Fleet Dashboard
3 apps | 2 healthy | 1 unhealthy

APP       SYSTEMD   CONTAINERS   HEALTH
myapp     active    2/2          ✓ healthy
api       active    1/1          ✓ healthy
worker    failed    0/1          ✗ down
```

```bash
$ fleet status --json
{
  "apps": [
    {
      "name": "myapp",
      "service": "myapp",
      "systemd": "active",
      "containers": "2/2",
      "health": "healthy"
    }
  ],
  "totalApps": 3,
  "healthy": 2,
  "unhealthy": 1
}
```

### Health states

| State | Meaning |
|-------|---------|
| `healthy` | systemd active, all containers running and healthy |
| `degraded` | systemd active but one or more containers are not running |
| `down` | systemd unit is not active |
| `frozen` | App was frozen with `fleet freeze` |
| `unknown` | No containers registered or found |

### Related

- **MCP tool:** `fleet_status`
- See also: [`fleet health`](/cli/health) for detailed per-app health checks

---

## fleet list

List all apps registered in the fleet registry.

### Usage

```bash
fleet list [--json]
```

### Flags

| Flag | Description |
|------|-------------|
| `--json` | Output raw JSON array of all app entries |

### Examples

```bash
$ fleet list
Registered Apps (3)

NAME     SERVICE   PORT   TYPE    DOMAINS
myapp    myapp     3000   proxy   myapp.example.com
api      api       8080   proxy   api.example.com
worker   worker    -      service -
```

```bash
$ fleet list --json
[
  {
    "name": "myapp",
    "displayName": "myapp",
    "composePath": "/srv/myapp",
    "serviceName": "myapp",
    "domains": ["myapp.example.com"],
    "port": 3000,
    "type": "proxy",
    ...
  }
]
```

### Related

- **MCP tool:** `fleet_list`
