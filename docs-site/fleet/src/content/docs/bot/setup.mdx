---
title: Bot Setup
description: How to install, configure, and run fleet-bot
---

import { Aside } from '@astrojs/starlight/components';

fleet-bot is a Go binary that connects your messaging adapter (Telegram or iMessage via BlueBubbles) to fleet commands. It runs as a Docker Compose service alongside your other apps.

## Prerequisites

- Docker and Docker Compose on the host
- fleet CLI installed and configured
- A Telegram bot token **or** a running BlueBubbles server
- `/etc/fleet/bot.json` config file (see below)

## Install

The bot lives in `bot/` and has its own `docker-compose.yml`.

```bash
cd /path/to/fleet/bot
docker compose up -d --build
```

The container uses `network_mode: host` so it can reach the Docker daemon and systemd bus directly.

## Configuration

Create `/etc/fleet/bot.json`. The bot reads this file at startup from `config.DefaultConfigPath`.

### Full config reference

```json
{
  "adapters": {
    "telegram": {
      "enabled": true,
      "botToken": "123456:ABC-DEF...",
      "allowedChatIds": [-1001234567890],
      "alertChatIds": [-1001234567890]
    },
    "imessage": {
      "enabled": false,
      "serverUrl": "https://bb.example.com",
      "port": 1234,
      "password": "your-bb-password",
      "cfAccessClientId": "abc123.access",
      "cfAccessClientSecret": "secret",
      "webhookPort": 8080,
      "allowedNumbers": ["+447700900000"],
      "alertChatGuids": ["iMessage;-;+447700900000"]
    }
  },
  "alerts": {
    "providers": [],
    "maxConsecutiveFailures": 5,
    "pollInterval": "2m"
  },
  "openaiKey": ""
}
```

### Field reference

#### `adapters.telegram`

| Field | Type | Description |
|---|---|---|
| `enabled` | boolean | Set to `true` to activate the Telegram adapter |
| `botToken` | string | Bot token from @BotFather |
| `allowedChatIds` | int64[] | Chat IDs that may send commands. Messages from other chats are silently dropped |
| `alertChatIds` | int64[] | Chat IDs that receive automated health alerts |

#### `adapters.imessage`

| Field | Type | Description |
|---|---|---|
| `enabled` | boolean | Set to `true` to activate the iMessage adapter |
| `serverUrl` | string | Base URL of the BlueBubbles server (no trailing slash) |
| `port` | int | BlueBubbles server port (informational — not used directly by the bot) |
| `password` | string | BlueBubbles API password, appended as `?password=` on REST calls |
| `cfAccessClientId` | string | Cloudflare Access service token client ID (sent as `CF-Access-Client-Id` header) |
| `cfAccessClientSecret` | string | Cloudflare Access service token client secret (sent as `CF-Access-Client-Secret` header) |
| `webhookPort` | int | Local port the bot listens on for incoming BlueBubbles webhook events |
| `allowedNumbers` | string[] | Phone numbers in E.164 format whose messages the bot will process |
| `alertChatGuids` | string[] | BlueBubbles chat GUIDs for alert delivery (format: `iMessage;-;+447700900000`) |

#### `alerts`

| Field | Type | Default | Description |
|---|---|---|---|
| `providers` | string[] | `[]` | Reserved for future use |
| `maxConsecutiveFailures` | int | `5` | Number of consecutive poll failures before an app is auto-frozen |
| `pollInterval` | string | `"2m"` | How often the alert monitor polls fleet status. Accepts Go duration strings (`"1m"`, `"30s"`, etc.) |

#### `openaiKey`

Optional. Provide an OpenAI API key to enable AI-assisted command features.

### Legacy format

If `adapters` is omitted, the bot falls back to the old `/etc/fleet/telegram.json` format with `botToken` and `chatId` fields at the top level.

## Systemd service (optional)

To run without Docker, or to auto-start the Docker Compose stack on boot, create a systemd service:

```ini
# /etc/systemd/system/fleet-bot.service
[Unit]
Description=fleet-bot messaging interface
After=docker.service
Requires=docker.service

[Service]
WorkingDirectory=/path/to/fleet/bot
ExecStart=/usr/bin/docker compose up
ExecStop=/usr/bin/docker compose down
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

```bash
systemctl daemon-reload
systemctl enable --now fleet-bot
```

<Aside type="caution">
The bot container needs access to the Docker socket, the systemd D-Bus socket, and the fleet CLI. Review the volume mounts in `bot/docker-compose.yml` before deploying. Many operations (restart, start, stop, logs) require that the host fleet CLI binary is reachable inside the container.
</Aside>

## Volume mounts

The `bot/docker-compose.yml` mounts the following into the container:

| Host path | Purpose |
|---|---|
| `/var/run/docker.sock` | Docker API (read-only) |
| `/usr/bin/docker` | Docker CLI binary |
| `/proc`, `/sys` | Host metrics for `/sys` and `/digest` |
| `/etc/fleet/bot.json` | Bot config (read-only) |
| `/etc/nginx` | Nginx configs for `/nginx list` |
| `/etc/truewaf` | WAF config (read-write for whitelist changes) |
| `/var/log/truewaf` | WAF logs for `/waf logs` |
| `$HOST_HOME` | Home dir — fleet CLI, app directories |
| `/usr/local/bin/node` | Node.js runtime for fleet CLI |
| `/run/fleet-secrets` | Runtime secrets (read-only) |
| `/run/dbus/system_bus_socket` | systemd D-Bus for `systemctl` calls |

Set `HOST_HOME` in your environment or the default `/root` is used.
