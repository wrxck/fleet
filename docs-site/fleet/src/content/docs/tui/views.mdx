---
title: TUI Views
description: Dashboard, Health, Secrets, Logs, and detail views
---

import { Aside } from '@astrojs/starlight/components';

The TUI has six views — three top-level and three detail views.

## Dashboard

The default view. Shows all registered apps with:

- App name
- Systemd service state (active / inactive)
- Container count and running status
- Port number (if configured)

Press **Enter** on an app to open its detail view. Press **Tab** to switch to Health.

Data refreshes automatically via the `useFleetData` hook, which polls `fleet status --json`.

## Health

Shows health check results for every app. Each entry displays:

- App name with overall status badge: **healthy** (green), **degraded** (yellow), **down** (red)
- Systemd state
- Container health
- HTTP check result (for apps with a configured port)

A summary bar at the top shows aggregate counts.

Health is determined by three checks:
1. **Systemd** — is the service unit active?
2. **Containers** — are all expected containers running?
3. **HTTP** — does `curl http://127.0.0.1:<port>/health` return 2xx–4xx?

If all pass, the app is **healthy**. If containers are down, it's **down**. Otherwise **degraded**.

## Secrets

A two-level view for managing the age-encrypted vault.

### App list (first level)

Shows apps with sealed secrets, key counts, and vault type (`env-file` or `secrets-dir`). The header shows the vault seal status.

### Secret list (second level)

Press Enter on an app to see its secrets. Values are redacted by default — press `r` to reveal a single value, or `x` globally.

Available actions:
- `u` unseal vault — decrypts to `/run/fleet-secrets/`
- `l` seal vault — removes runtime copies
- `a` add secret — opens the secret editor
- `d` delete secret — with y/n confirmation

## App Detail

Opened from the Dashboard. Shows full info for one app:

- Registry entry (compose path, service name, domains, port)
- Individual container statuses
- Systemd service status
- HTTP health check result

Press **Esc** to return to Dashboard.

## Logs

Opened from App Detail. Displays the last 200 lines of `docker compose logs` output.

- Press `f` to toggle **follow mode** (live-streams new output)
- Auto-scrolls to bottom while following
- Buffer capped at 200 lines for memory stability

Press **Esc** to return to App Detail.

## Secret Edit

A text input for adding or modifying a secret. All global shortcuts are disabled — the editor captures all keyboard input. Press **Enter** to save, **Esc** to cancel.

## Vault status indicator

The header bar polls vault status every 5 seconds and shows **Sealed** or **Unsealed**. This lets you see at a glance whether secrets are available to containers.
