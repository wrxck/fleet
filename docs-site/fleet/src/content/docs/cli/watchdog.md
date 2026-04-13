---
title: Watchdog
description: Monitor apps and trigger alerts on failure
---

## fleet watchdog

Check all registered apps and the `docker-databases` service for health issues. If any failures are found, send an alert via the configured notification adapters (Telegram).

Designed to be run on a cron schedule (e.g. every 5 minutes). Exits with code 1 if any services are unhealthy.

### Usage

```bash
fleet watchdog [--motd]
```

### Flags

| Flag | Description |
|------|-------------|
| `--motd` | Display failures only, do not send alerts. Always exits 0. Useful for SSH login banners. |

### Examples

All healthy:

```bash
$ fleet watchdog
✓ All 4 services healthy
```

With failures:

```bash
$ fleet watchdog
! 2 service(s) unhealthy
✗   worker: down (systemd: failed)
✗   api: degraded (containers down: api-web-1; http check failed)
✓ Alert sent
```

With `--motd` (no alerts):

```bash
$ fleet watchdog --motd
! 1 service(s) unhealthy
✗   worker: down (systemd: failed)
```

### What watchdog checks

1. `docker-databases` systemd unit status
2. For each registered app:
   - systemd unit state (must be `active`)
   - Container running status
   - HTTP health endpoint (if `healthPath` is set in the registry)

### Notification configuration

Watchdog reads notify config from `/etc/fleet/notify.json`. It supports Telegram:

```json
{
  "telegram": {
    "botToken": "123456:ABC-DEF...",
    "chatId": "-100..."
  }
}
```

### Running on a cron schedule

```bash
# /etc/cron.d/fleet-watchdog
*/5 * * * * root /usr/local/bin/fleet watchdog
```

### Running as an MOTD script

```bash
# /etc/update-motd.d/98-fleet-watchdog
#!/bin/bash
/usr/local/bin/fleet watchdog --motd
```
