---
title: Boot Refresh
description: How fleet pulls the latest code and rebuilds stale images on every boot
---

import { Aside } from '@astrojs/starlight/components';

Fleet's boot refresh feature runs automatically when systemd starts a registered app. It pulls the latest commits from the app's git remote, rebuilds the Docker image only if something changed, and then starts the container — all without risking downtime if anything goes wrong.

## Overview

Daily SEO automation and similar background jobs push commits while the server is running. When the server reboots, those changes need to be picked up. Boot refresh closes that loop: pull → rebuild-if-stale → up, with a fail-safe at every step.

## The fail-safe contract

Every refresh step is best-effort. Any failure — network error, build failure, lock contention — falls through gracefully to a plain `docker compose up` using the existing image. The app always starts, even if the refresh could not complete.

Additional guardrails:

- **900 s wall-clock cap** — if the full refresh pipeline exceeds 15 minutes, it aborts and the existing image is used.
- **Kill switch** — creating `/etc/fleet/no-auto-refresh` disables the refresh pipeline entirely for all apps. The file is checked before any network I/O.

## Pipeline

```
systemd ExecStart: fleet boot-start <app>
│
├── Kill switch check (/etc/fleet/no-auto-refresh)
│   └── if present → skip refresh, run docker compose up
│
├── Load registry entry for <app>
│   └── if missing → skip refresh, run docker compose up
│
├── Refresh pipeline (wall-clock cap: 900 s)
│   ├── Preflight  — verify git repo exists at compose dir
│   ├── Fetch      — git fetch origin (best-effort, skipped on error)
│   ├── FF-merge   — git merge --ff-only origin/<branch>
│   ├── Build-if-stale — docker compose build only if HEAD ≠ lastBuiltCommit
│   └── Record     — update lastBuiltCommit in registry on success
│
└── docker compose up -d --force-recreate
    (always runs, regardless of refresh outcome)
```

## Commands

---

### fleet boot-start

Run the boot refresh pipeline and start an app. This is the command systemd invokes via `ExecStart`. It is not normally run by hand.

```bash
fleet boot-start <app>
```

| Argument | Required | Description |
|----------|----------|-------------|
| `app` | Yes | App name (as registered in the registry) |

---

### fleet rollback

Restore the previous image and restart the app. Fleet tags the image as `<repo>:fleet-previous` automatically before every build. If a post-build regression is found, this command reverts it.

```bash
fleet rollback <app>
```

| Argument | Required | Description |
|----------|----------|-------------|
| `app` | Yes | App name |

```bash
$ sudo fleet rollback myapp
Rolling back myapp to fleet-previous...
✓ Rolled back myapp
```

---

### fleet patch-systemd

Migrate already-installed systemd units from the old `ExecStart` (`docker compose up`) to the new `fleet boot-start <app>` form. Backs up each original unit file as `<path>.service.bak` before writing.

```bash
sudo fleet patch-systemd [<app>] [--rollback]
```

Run without arguments to patch all registered apps at once. Pass an app name to patch a single service.

| Flag | Description |
|------|-------------|
| `--rollback` | Restore all backed-up `.service.bak` files and run `daemon-reload` |

```bash
# Patch all apps
$ sudo fleet patch-systemd
Patching fleet-myapp.service...
✓ Backed up to /etc/systemd/system/fleet-myapp.service.bak
✓ Patched fleet-myapp.service
Reloading systemd daemon...
✓ Done

# Roll back if something goes wrong
$ sudo fleet patch-systemd --rollback
Restoring fleet-myapp.service from backup...
✓ Restored fleet-myapp.service
Reloading systemd daemon...
✓ Done
```

---

## Configuration

### `AppEntry.lastBuiltCommit`

A per-app registry field (`data/registry.json`) set on every successful `fleet deploy` or boot-refresh build. The refresh pipeline compares the current git `HEAD` against this value to decide whether to rebuild. If they match, the build step is skipped entirely.

### Kill switch

```bash
sudo touch /etc/fleet/no-auto-refresh
```

Remove the file to re-enable boot refresh.

<Aside type="caution">
Apps with an unset `lastBuiltCommit` (i.e. registered before 1.5.0 and not yet re-deployed) will rebuild on their first post-upgrade start. Expect a longer first boot for those apps.
</Aside>

## Recovery escape hatches

| Situation | Recovery |
|-----------|----------|
| One app misbehaves after build | `sudo fleet rollback <app>` |
| Registry corruption at startup | Fleet auto-loads `.bak` on next read |
| Broad boot-refresh issue | `sudo touch /etc/fleet/no-auto-refresh` |
| Need to revert systemd changes | `sudo fleet patch-systemd --rollback` |
