---
title: Watchdog
description: Monitor apps, restart a failed app, and alert when the failure set changes
---

## fleet watchdog

Check all registered apps and the `docker-databases` service for health issues. Restart an app that is down with a failed unit. Send an alert when the set of failures changes.

Designed to run on a systemd timer (the shipped unit runs it every 15 minutes).

### Usage

```bash
fleet watchdog [--motd] [--no-remediate] [--force-alert]
```

### Flags

| Flag | Description |
|------|-------------|
| `--motd` | Display failures only. No restarts, no alerts, no state written. Always exits 0. Useful for SSH login banners. |
| `--no-remediate` | Report and alert, but never restart anything. |
| `--force-alert` | Send an alert on this run even if nothing has changed. Use it to test that the notify adapters still work. |

### Remediation

A restart is attempted only when **both** conditions hold:

- the app is **down** — no running container, so a restart can cost nothing, and
- systemd reports its unit as **failed** — an inactive unit can be a deliberate stop.

A **degraded** app is never restarted. It is still serving traffic, and `systemctl restart` runs the unit's `ExecStop` first, which would take that away. The shared databases are never restarted either: their state comes from systemd alone, with no container check, and every app depends on them.

Limits:

- at most **2 restart attempts per app per rolling hour**, and
- at most **5 restarts per run**, so one bad reboot cannot make a run outlast its own timer interval.

Each attempt is written to the state file *before* the restart is issued. If that write fails, remediation stops rather than running without a rate limit.

After a successful restart the app is re-checked. If it came back, it is dropped from the alert.

### Alerting

An alert is sent when:

- the failure set changes, or
- 24 hours have passed since the last alert and the set is unchanged (a daily digest), or
- everything recovered after a run that reported failures.

An unchanged failure set inside the digest window is suppressed. Resending an identical message every 15 minutes trains the reader to ignore it.

The message separates **down** from **degraded**, and lists any restart attempts with their outcome.

State lives at `/var/lib/fleet/watchdog-state.json`.

### Exit code

Exits 1 only when the alert could **not** be sent — no config at `/etc/fleet/notify.json`, or every adapter failed. An unhealthy app exits 0.

This changed in 1.18.0. Earlier versions exited 1 whenever any service was unhealthy, which left `fleet-watchdog.service` permanently `failed` and hid genuine unit failures in `systemctl --failed`. If you have a wrapper that keys on the exit code to detect an unhealthy fleet, use `fleet health --json` instead.

### Examples

All healthy:

```bash
$ fleet watchdog
All 4 services healthy
```
