---
title: Nginx
description: Manage nginx virtual host configurations via fleet
---

Fleet generates nginx server blocks, writes them to `/etc/nginx/sites-available/`, symlinks them to `sites-enabled/`, tests the config, and reloads nginx.

:::note[Root required]
All nginx commands require root privileges.
:::

---

## fleet nginx add

Create an nginx server block for a domain and reload nginx.

### Usage

```bash
fleet nginx add <domain> --port <port> [--type proxy|spa|nextjs] [--dry-run] [-y]
```

### Arguments

| Argument | Required | Description |
|----------|----------|-------------|
| `domain` | Yes | Domain name (e.g. `myapp.example.com`) |

### Flags

| Flag | Description |
|------|-------------|
| `--port <port>` | Backend port (required) |
| `--type proxy\|spa\|nextjs` | Config type (default: `proxy`) |
| `--dry-run` | Print the generated config without writing it |
| `-y`, `--yes` | Skip confirmation prompts |

### Config types

| Type | Description |
|------|-------------|
| `proxy` | Reverse proxy to a backend port (default) |
| `spa` | Static SPA with `try_files` fallback to `index.html` |
| `nextjs` | Next.js-specific proxy with static asset handling |

### Examples

```bash
$ fleet nginx add myapp.example.com --port 3000
✓ Installed myapp.example.com.conf
✓ Nginx config test passed
✓ Nginx reloaded - myapp.example.com is live
  Run certbot to add SSL: certbot --nginx -d myapp.example.com -d www.myapp.example.com
```

```bash
$ fleet nginx add myapp.example.com --port 3000 --dry-run
Generated config:
server {
    listen 80;
    server_name myapp.example.com;
    ...
}
! Dry run - no changes made
```

```bash
$ fleet nginx add myapp.example.com --port 3000 --type spa
```

### Related

- **MCP tool:** `fleet_nginx_add`

---

## fleet nginx remove

Remove an nginx server block and reload nginx.

### Usage

```bash
fleet nginx remove <domain> [-y]
```

### Arguments

| Argument | Required | Description |
|----------|----------|-------------|
| `domain` | Yes | Domain name to remove |

### Flags

| Flag | Description |
|------|-------------|
| `-y`, `--yes` | Skip confirmation prompt |

### Examples

```bash
$ fleet nginx remove myapp.example.com
? Remove nginx config for myapp.example.com? (y/N) y
✓ Removed myapp.example.com.conf
✓ Nginx reloaded
```

---

## fleet nginx list

List all nginx site configs managed in `sites-available/`.

### Usage

```bash
fleet nginx list [--json]
```

### Flags

| Flag | Description |
|------|-------------|
| `--json` | Output raw JSON |

### Examples

```bash
$ fleet nginx list
Nginx Sites (2)

DOMAIN                  STATUS    SSL
myapp.example.com       enabled   ssl
api.example.com         enabled   no ssl
```

### Related

- **MCP tool:** `fleet_nginx_list`
