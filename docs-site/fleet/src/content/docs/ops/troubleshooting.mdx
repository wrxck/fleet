---
title: Troubleshooting
description: Common problems and how to resolve them
---

import { Aside } from '@astrojs/starlight/components';

## "requires root privileges"

```
Error: 'fleet start' requires root privileges. Run with sudo.
```

Commands that manage services, secrets, or nginx need root. Prefix with `sudo`:

```bash
sudo fleet start myapp
```

Read-only commands (`status`, `list`, `health`, `logs`, `deps status`, `tui`) work without root.

## App shows "down" but containers are running

Fleet checks container names from the registry. If your `docker-compose.yml` changed container names since registration, fleet won't find them.

**Fix**: Re-register the app or update the registry:

```bash
sudo fleet remove myapp
sudo fleet add myapp /path/to/compose --port 3000
```

## Systemd service won't start

Check the service logs:

```bash
journalctl -u fleet-myapp.service -n 50 --no-pager
```

Common causes:
- **Compose file not found** — the `WorkingDirectory` in the service file doesn't match. Run `sudo fleet patch-systemd myapp`.
- **Port conflict** — another service is using the same port. Check with `ss -tlnp | grep <port>`.
- **Docker not running** — the service depends on `docker.service`. Check `systemctl status docker`.

## Secrets won't unseal

```
Error: vault is not initialized
```

Run `sudo fleet secrets init` first. This creates the age key at `/etc/fleet/age.key` and the vault directory.

```
Error: age key not found at /etc/fleet/age.key
```

The encryption key is missing. If you have a backup, restore it. If not, you'll need to re-import all secrets.

## Drift detected

```bash
sudo fleet secrets drift
```

If this shows "drifted", the runtime secrets in `/run/fleet-secrets/` don't match the vault. This happens when:
- Someone edited runtime files directly (don't do this)
- The vault was re-sealed with changes but not unsealed again

**Fix**: Re-unseal to sync:

```bash
sudo fleet secrets unseal
```

## Nginx config test fails

```bash
sudo fleet nginx add myapp
# Error: nginx configuration test failed
```

Check the full error:

```bash
sudo nginx -t
```

Common causes:
- Duplicate `server_name` — another config already claims that domain
- Syntax error in a manually edited config file
- Missing SSL certificate referenced in an existing config

## Docker compose build fails during deploy

```bash
sudo fleet deploy myapp
# Error: docker compose build failed
```

Check the build output:

```bash
cd /path/to/app && docker compose build --no-cache 2>&1
```

Common causes:
- Dockerfile syntax error
- Missing build context files
- Network issues pulling base images

## TUI won't launch

```bash
sudo fleet
# Error or blank screen
```

The TUI requires a terminal that supports ANSI escape codes. It won't work in:
- Non-interactive shells (cron, CI)
- Terminals with `TERM=dumb`

<Aside>
If the TUI flickers when scrolling, update to the latest fleet version — this was fixed with memoized row rendering in ink-scrollable-list.
</Aside>

## Health check shows "degraded" with HTTP error

The HTTP check hits `http://127.0.0.1:<port>/health` directly. If your app:
- Doesn't have a `/health` endpoint — set a custom path: `fleet add myapp --health-path /api/ping`
- Requires HTTPS — the check uses HTTP only (it's localhost, no TLS needed)
- Takes time to start — the 5-second timeout may not be enough for slow-starting apps

## Getting more help

```bash
# View fleet help
fleet --help

# Check version
fleet --version

# View all registered apps
fleet list
```
