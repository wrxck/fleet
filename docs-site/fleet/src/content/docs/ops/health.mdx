---
title: Health Checks
description: Multi-layer health checking for fleet-managed apps
---

import { Aside } from '@astrojs/starlight/components';

Fleet performs three-layer health checks for each registered app: systemd service state, Docker container status, and HTTP endpoint.

## How it works

For each app, fleet checks:

1. **Systemd** — is the service unit active? (`systemctl show`)
2. **Containers** — are all expected containers running? (`docker ps`)
3. **HTTP** — does `curl http://127.0.0.1:<port><healthPath>` return a 2xx–4xx status?

The overall result is:

| Condition | Status |
|-----------|--------|
| All checks pass | **healthy** |
| Containers down | **down** |
| Any other failure | **degraded** |

HTTP checks are only run for apps with a configured `port`. If no port is set, the HTTP layer is skipped.

## Running health checks

```bash
# Check all apps
sudo fleet health

# Check a specific app
sudo fleet health myapp
```

The output shows each layer's result per app.

## Health path

By default, fleet checks `/health`. You can configure a custom path per app when registering:

```bash
sudo fleet add myapp --port 3000 --health-path /api/status
```

Health paths are validated against `^/[a-zA-Z0-9/_.-]*$` to prevent injection.

## Prefetched data

When checking all apps, fleet optimises by prefetching:
- All Docker containers in one `docker ps` call
- All systemd service statuses in one `systemctl show` call

This avoids N+1 queries when you have many apps. Individual health checks (`fleet health myapp`) fetch data per-app.

## HTTP check details

The HTTP check uses `curl` with:
- 5-second timeout (`--max-time 5`)
- Only reads the status code (`-w '%{http_code}'`)
- Any 2xx–4xx response is considered healthy (4xx means the endpoint exists but returned an error — the app is running)
- 5xx or connection failure means unhealthy

<Aside>
HTTP checks hit `127.0.0.1` directly, bypassing nginx. This tests the app container itself, not the reverse proxy.
</Aside>

## In the TUI

The Health view in the TUI shows all apps with colour-coded status badges and auto-refreshes. See [TUI Views](/tui/views/) for details.

## In the MCP server

The `fleet_health` MCP tool returns health check results as JSON, making it available to Claude Code for automated monitoring.

## Privilege requirements

Health checks require **root** for systemd queries and Docker access. The `fleet health` command checks for root at startup.
