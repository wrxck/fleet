---
title: Alerts & Monitoring
description: Automated health alerts, ping monitoring, uptime tracking, and daily digests
---

import { Aside } from '@astrojs/starlight/components';

fleet-bot includes four monitoring systems that run continuously and send alerts through your configured adapter.

## Alert Monitor

Polls `fleet health` every **2 minutes** and alerts on state transitions.

- Tracks per-app health state (`healthy`, `degraded`, `down`)
- Only alerts when state **changes** (no repeated alerts for the same issue)
- **Auto-restart**: optionally restarts apps that go down (with 10-minute cooldown between restarts)
- **Mute non-critical**: when enabled, only alerts on `down` transitions (ignores `degraded`)

### Commands

```
/alerts              — show current settings + toggle buttons
/alerts on|off       — enable/disable monitoring
/alerts autorestart  — toggle auto-restart
/alerts mute         — toggle mute non-critical
```

## Ping Monitor

HTTP-pings all app domains every **3 minutes**.

- Checks each app's configured domains with a 10-second timeout
- Alerts on failures (connection error, timeout, 5xx status)
- Alerts on slow responses (> 3 seconds)
- Tracks per-domain status and latency

### Commands

```
/ping          — show all ping results
/ping on|off   — enable/disable
```

## Uptime Tracker

Polls app health every **2 minutes** and persists uptime data to `/etc/fleet/uptime.json`.

- Records upticks/downticks per app
- Calculates uptime percentage over time
- Data survives bot restarts (persisted to disk)

### Commands

```
/uptime        — show uptime percentages for all apps
```

## Daily Digest

Sends a summary message at **08:00 UTC** daily.

- App health overview (healthy/degraded/down counts)
- Uptime percentages for the past 24 hours
- Ping latency summary
- Alert count since last digest

### Commands

```
/digest         — show digest settings
/digest on|off  — enable/disable daily digest
```

## Scheduled deployments

```
/deploy_at 14:30 myapp
```

Schedules a deployment at the specified time. The digest manager handles the scheduling.

<Aside>
All monitoring timers start automatically when the bot starts. Use the commands to toggle them on/off without restarting the bot.
</Aside>

## Alert destination

Alerts are sent to the first entry in `alertChatIds` (Telegram) or `allowedNumbers` (BlueBubbles). Configure this in `/etc/fleet/bot.json`.
