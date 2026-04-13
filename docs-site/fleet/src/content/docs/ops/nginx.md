---
title: Nginx Management
description: Managing reverse proxy configuration with fleet
---

import { Aside } from '@astrojs/starlight/components';

Fleet manages nginx reverse proxy configuration for your apps. Each app with a domain gets an nginx server block that proxies traffic from the domain to the app's local port.

## How it works

Fleet writes nginx config files to the standard Debian/Ubuntu paths:

- **Available**: `/etc/nginx/sites-available/<domain>.conf`
- **Enabled**: `/etc/nginx/sites-enabled/<domain>.conf` (symlink)

When you run `fleet nginx add`, fleet:
1. Generates an nginx config from the app's registry entry
2. Writes it to `sites-available`
3. Creates a symlink in `sites-enabled`
4. Tests the config with `nginx -t`
5. Reloads nginx with `systemctl reload nginx`

## Adding a site

```bash
sudo fleet nginx add myapp
```

This reads the app's domains and port from the registry and generates the appropriate config. The generated config includes:

- Reverse proxy to `127.0.0.1:<port>`
- WebSocket upgrade headers
- Proxy headers (`X-Real-IP`, `X-Forwarded-For`, `X-Forwarded-Proto`)
- Standard timeouts

## Listing sites

```bash
fleet nginx list
```

Shows all fleet-managed nginx sites with their domain, enabled status, and SSL status. This reads from `/etc/nginx/sites-available/` and checks for corresponding symlinks in `sites-enabled/`.

## Removing a site

```bash
sudo fleet nginx remove <domain>
```

Removes both the config file and its symlink, then reloads nginx.

## Generated config

For an app on port 3000 with domain `myapp.example.com`:

```nginx
server {
    listen 80;
    server_name myapp.example.com;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

<Aside>
SSL termination is handled externally (e.g., by Certbot). Fleet generates the initial HTTP config — run `certbot --nginx -d myapp.example.com` after adding the site to add HTTPS.
</Aside>

## Config validation

Fleet validates all inputs:
- **Domain names** are checked against a strict regex (`^[a-zA-Z0-9][a-zA-Z0-9.-]*$`)
- **Port numbers** must be valid integers
- The `nginx -t` test runs before any reload

If the config test fails, fleet reports the error and does not reload.

## Privilege requirements

All nginx operations require **root** — writing to `/etc/nginx/` and reloading the service both need elevated privileges.

## Extracting info from configs

Fleet can parse existing nginx configs to extract:
- **Port**: from `proxy_pass` directives
- **Domains**: from `server_name` directives

This is used by `fleet status` to display domain and port info even for apps that were configured outside fleet.
