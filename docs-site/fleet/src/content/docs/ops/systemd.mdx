---
title: Systemd Integration
description: How fleet uses systemd to manage Docker Compose services
---

import { Aside, Tabs, TabItem } from '@astrojs/starlight/components';

Fleet creates a systemd service unit for each registered app. This gives you `systemctl start/stop/restart`, boot ordering, automatic restart on failure, and dependency management.

## How it works

When you run `fleet deploy <app>`, fleet:

1. Generates a `.service` unit file from the app's registry entry
2. Writes it to `/etc/systemd/system/<serviceName>.service`
3. Runs `systemctl daemon-reload`
4. Enables and starts the service

The service unit uses `Type=oneshot` with `RemainAfterExit=yes` — it runs `docker compose up -d` on start and `docker compose down` on stop.

## Generated service file

```ini
[Unit]
Description=myapp (fleet-managed)
Requires=docker.service
After=docker.service network-online.target
Wants=network-online.target

[Service]
Type=oneshot
RemainAfterExit=yes
WorkingDirectory=/opt/apps/myapp
ExecStartPre=-/usr/bin/docker compose down
ExecStart=/usr/bin/docker compose up -d --force-recreate
ExecStop=/usr/bin/docker compose down --timeout 30
ExecReload=/usr/bin/docker compose restart
TimeoutStartSec=300
TimeoutStopSec=60
Restart=on-failure
RestartSec=10

[Install]
WantedBy=multi-user.target
```

### Database dependency

If an app has `dependsOnDatabases: true` in its registry entry, the unit adds:

```ini
Requires=docker.service docker-databases.service
After=docker.service docker-databases.service network-online.target
```

This ensures your database containers are running before the app starts.

### Custom compose file

If the app specifies a `composeFile`, the unit adds the `-f` flag:

```ini
ExecStart=/usr/bin/docker compose -f "docker-compose.prod.yml" up -d --force-recreate
```

## Boot order

Fleet manages boot ordering through systemd dependencies:

1. `docker.service` starts first (system-provided)
2. `docker-databases.service` starts (if you have shared databases)
3. App services start (after their dependencies)
4. `fleet-unseal.service` decrypts secrets before apps that need them

<Aside>
The `fleet-unseal.service` unit is created by `fleet secrets init`. It runs `fleet secrets unseal` before any app service that needs runtime secrets.
</Aside>

## Common operations

```bash
# Check if systemd is available
systemctl is-system-running

# View fleet-managed service status
sudo fleet status

# Restart a specific app
sudo fleet restart myapp

# View service logs via journalctl
journalctl -u fleet-myapp.service -f
```

## Privilege requirements

All systemd operations require **root**. The `fleet start`, `fleet stop`, `fleet restart`, and `fleet deploy` commands check for root and exit with a clear error if not running as root.

## Patching existing services

If you modify an app's registry entry (change compose file, add database dependency), run:

```bash
sudo fleet patch-systemd myapp
```

This regenerates the service file and reloads the systemd daemon without restarting the app.
