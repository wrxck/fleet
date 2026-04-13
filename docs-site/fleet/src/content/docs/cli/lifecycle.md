---
title: Lifecycle
description: Deploy, start, stop, restart, add, and remove fleet apps
---

These commands manage the full lifecycle of Docker Compose applications registered in the fleet registry.

:::note[Root required]
All lifecycle commands require root privileges because they interact with systemd.
:::

---

## fleet deploy

Full deployment pipeline: register the app if needed, build the Docker image, then start or restart the systemd service.

### Usage

```bash
fleet deploy <app-dir> [--dry-run] [-y]
```

### Arguments

| Argument | Required | Description |
|----------|----------|-------------|
| `app-dir` | Yes | Path to the directory containing `docker-compose.yml` |

### Flags

| Flag | Description |
|------|-------------|
| `--dry-run` | Show what would happen without making changes |
| `-y`, `--yes` | Skip confirmation prompts |

### Examples

```bash
$ fleet deploy /srv/myapp
Deploy Pipeline
Building myapp...
✓ Build complete
Starting myapp...
✓ Deployed myapp
```

```bash
$ fleet deploy /srv/myapp --dry-run
Deploy Pipeline
Would build and deploy myapp
! Dry run - no changes made
```

### What deploy does

1. If the app is not registered, runs `fleet add <app-dir>` first
2. Runs `docker compose build` in the compose directory
3. If the systemd service is already active, restarts it; otherwise starts it

### Related

- **MCP tool:** `fleet_deploy`

---

## fleet start

Start an app's systemd service.

### Usage

```bash
fleet start <app>
```

### Arguments

| Argument | Required | Description |
|----------|----------|-------------|
| `app` | Yes | App name (as registered in the registry) |

### Examples

```bash
$ fleet start myapp
✓ Started myapp
```

### Related

- **MCP tool:** `fleet_start`

---

## fleet stop

Stop an app's systemd service.

### Usage

```bash
fleet stop <app>
```

### Arguments

| Argument | Required | Description |
|----------|----------|-------------|
| `app` | Yes | App name |

### Examples

```bash
$ fleet stop myapp
✓ Stopped myapp
```

### Related

- **MCP tool:** `fleet_stop`

---

## fleet restart

Restart an app's systemd service.

### Usage

```bash
fleet restart <app>
```

### Arguments

| Argument | Required | Description |
|----------|----------|-------------|
| `app` | Yes | App name |

### Examples

```bash
$ fleet restart myapp
✓ Restarted myapp
```

### Related

- **MCP tool:** `fleet_restart`

---

## fleet add

Register an existing Docker Compose app in the fleet registry without deploying or building it. Creates a systemd service unit if one does not already exist.

### Usage

```bash
fleet add <app-dir> [--dry-run] [-y]
```

### Arguments

| Argument | Required | Description |
|----------|----------|-------------|
| `app-dir` | Yes | Path to the directory containing `docker-compose.yml` |

### Flags

| Flag | Description |
|------|-------------|
| `--dry-run` | Show what would be registered without writing anything |
| `-y`, `--yes` | Skip the confirmation prompt for creating a systemd service |

### Examples

```bash
$ fleet add /srv/myapp
Registering myapp from /srv/myapp
Compose path: /srv/myapp
Found containers: myapp-web-1, myapp-db-1
✓ Registered myapp
```

Fleet derives the app name from the directory name (lowercased, non-alphanumeric characters replaced with `-`). It looks for `docker-compose.yml` in the given directory or a `server/` subdirectory.

---

## fleet remove

Stop, disable, and deregister an app. The systemd service file is not deleted automatically.

### Usage

```bash
fleet remove <app> [-y]
```

### Arguments

| Argument | Required | Description |
|----------|----------|-------------|
| `app` | Yes | App name |

### Flags

| Flag | Description |
|------|-------------|
| `-y`, `--yes` | Skip the confirmation prompt |

### Examples

```bash
$ fleet remove myapp
? Remove myapp? This will stop and disable the service. (y/N) y
Stopping myapp...
Disabling myapp...
✓ Removed myapp from registry
! Service file not deleted - remove manually if needed
```

---

## fleet init

Auto-discover all Docker Compose apps on the server and register them. Useful when first setting up fleet on a server with existing apps.

### Usage

```bash
fleet init
```

Fleet scans common directories for `docker-compose.yml` files and calls `fleet add` for each one found.
