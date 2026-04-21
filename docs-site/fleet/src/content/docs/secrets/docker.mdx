---
title: Docker Integration
description: How fleet secrets are mounted into Docker Compose containers
---

import { Aside, Tabs, TabItem } from '@astrojs/starlight/components';

Fleet secrets are made available to containers through volume mounts from `/run/fleet-secrets/`. There are two mount modes depending on the secret type.

## Environment file mode (type: env)

For apps with `type: "env"` in the vault manifest, fleet writes a single `.env` file:

```
/run/fleet-secrets/myapp/.env
```

Mount it in your `docker-compose.yml`:

```yaml
services:
  app:
    env_file:
      - /run/fleet-secrets/myapp/.env
```

The `.env` file has permissions `0600` (root read-only). Docker reads it at container start to set environment variables.

## Secrets directory mode (type: secrets-dir)

For apps with `type: "secrets-dir"`, fleet writes individual files:

```
/run/fleet-secrets/myapp/secrets/db-password
/run/fleet-secrets/myapp/secrets/api-key
/run/fleet-secrets/myapp/secrets/tls.crt
```

Mount them using Docker Compose secrets:

```yaml
services:
  app:
    secrets:
      - db-password
      - api-key

secrets:
  db-password:
    file: /run/fleet-secrets/myapp/secrets/db-password
  api-key:
    file: /run/fleet-secrets/myapp/secrets/api-key
```

Inside the container, secrets appear at `/run/secrets/<name>`.

Individual files have permissions `0600`. The secrets directory has permissions `0700`.

## Boot ordering

Fleet provides a `fleet-unseal.service` systemd unit that runs before app services:

```ini
[Unit]
Description=Fleet secrets unseal
Before=fleet-myapp.service fleet-otherapp.service
After=docker.service

[Service]
Type=oneshot
ExecStart=/usr/local/bin/fleet secrets unseal

[Install]
WantedBy=multi-user.target
```

This ensures secrets are decrypted to `/run/fleet-secrets/` before any container tries to read them.

<Aside>
Since `/run/` is tmpfs, secrets are cleared on every reboot. The unseal service handles re-decryption automatically.
</Aside>

## Validation

`fleet secrets validate` reads your Docker Compose files and checks that every secret referenced in the `secrets:` block exists in the vault:

```bash
sudo fleet secrets validate
```

Output:
```
myapp: OK (3 secrets)
otherapp: MISSING db-password, EXTRA old-key
```

- **MISSING** — referenced in compose but not in vault
- **EXTRA** — in vault but not referenced in compose

This catches mismatches before they cause container startup failures.

## Choosing a mode

<Tabs>
  <TabItem label="env file">
  Best for apps that read configuration from environment variables. Most Node.js, Python, and Go apps work this way.
  
  ```bash
  sudo fleet secrets import myapp /path/to/.env
  ```
  </TabItem>
  <TabItem label="secrets-dir">
  Best for apps that read secrets from files (e.g., TLS certificates, database credentials read from `/run/secrets/`). Common with Docker Swarm-style secret handling.
  
  ```bash
  sudo fleet secrets set myapp db-password "hunter2"
  sudo fleet secrets set myapp tls.crt "$(cat cert.pem)"
  ```
  </TabItem>
</Tabs>
