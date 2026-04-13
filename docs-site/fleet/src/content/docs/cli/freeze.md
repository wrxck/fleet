---
title: Freeze
description: Freeze and unfreeze fleet apps to prevent crash-loop restarts
---

The freeze commands let you stop a crash-looping service and prevent systemd from restarting it, while recording the frozen state in the registry.

:::note[Root required]
These commands require root privileges because they interact with systemd.
:::

---

## fleet freeze

Stop an app, disable its systemd service, and mark it as frozen in the registry. Fleet will not start the service again until you explicitly unfreeze it.

Frozen apps appear with a `frozen` health state in `fleet status`.

### Usage

```bash
fleet freeze <app> [reason]
```

### Arguments

| Argument | Required | Description |
|----------|----------|-------------|
| `app` | Yes | App name |
| `reason` | No | Human-readable reason (stored in registry, shown in status) |

### Examples

```bash
$ fleet freeze worker "OOM crash loop, investigate memory usage"
✓ Frozen worker: OOM crash loop, investigate memory usage
```

```bash
$ fleet freeze myapp
✓ Frozen myapp
```

### What freeze does

1. Calls `systemctl stop <service>`
2. Calls `systemctl disable <service>`
3. Sets `frozenAt` and optionally `frozenReason` on the app entry in `registry.json`

### Related

- **MCP tool:** `fleet_freeze`

---

## fleet unfreeze

Clear the frozen state, re-enable the systemd service, and start it.

### Usage

```bash
fleet unfreeze <app>
```

### Arguments

| Argument | Required | Description |
|----------|----------|-------------|
| `app` | Yes | App name (must currently be frozen) |

### Examples

```bash
$ fleet unfreeze worker
✓ Unfrozen worker — service enabled and started
```

### What unfreeze does

1. Removes `frozenAt` and `frozenReason` from the registry entry
2. Calls `systemctl enable <service>`
3. Calls `systemctl start <service>`

### Related

- **MCP tool:** `fleet_unfreeze`
