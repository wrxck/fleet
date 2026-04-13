---
title: Quick Start
description: Get up and running with fleet in minutes
---

This walkthrough covers the most common first steps: discovering existing apps, checking status, deploying an app, running health checks, and initialising the secrets vault.

## 1. Auto-discover existing apps

If you already have Docker Compose apps on the server, `fleet init` scans for them and registers each one:

```bash
sudo fleet init
```

Fleet looks for `docker-compose.yml` files, generates a systemd service unit for each app, and adds them to the registry at `data/registry.json`.

## 2. Check the dashboard

```bash
sudo fleet status
```

Output:

```
Fleet Dashboard
3 apps | 2 healthy | 1 unhealthy

APP          SYSTEMD   CONTAINERS   HEALTH
myapp        active    2/2          ✓ healthy
api          active    1/1          ✓ healthy
worker       failed    0/1          ✗ down
```

## 3. Deploy an app

Point `fleet deploy` at the directory containing your `docker-compose.yml`:

```bash
sudo fleet deploy /srv/myapp
```

Fleet will:
1. Register the app if it is not already in the registry
2. Run `docker compose build`
3. Start (or restart) the systemd service

## 4. Run health checks

```bash
sudo fleet health
```

Check a single app:

```bash
sudo fleet health myapp
```

Health checks cover systemd unit state, container running status, and an optional HTTP endpoint if `healthPath` is set in the registry.

## 5. Initialise the secrets vault

```bash
sudo fleet secrets init
```

This generates an age keypair at `/etc/fleet/age.key`, writes the public key to the manifest, and installs a `fleet-unseal.service` systemd unit that decrypts secrets to `/run/fleet-secrets/` on boot.

Once the vault is initialised, import an existing `.env` file:

```bash
sudo fleet secrets import myapp /srv/myapp/.env
```

Check vault status at any time:

```bash
sudo fleet secrets status
```

## Next steps

- See the [CLI Reference](/cli/overview) for all available commands
- Set up [nginx](/cli/nginx) for a domain
- Configure the [MCP server](/mcp/setup) for Claude Code integration
