---
title: Architecture
description: How fleet is structured and how its components fit together
---

## CLI architecture

```mermaid
graph TD
    CLI["fleet CLI\n(src/cli.ts)"]

    CLI --> status["status / list"]
    CLI --> lifecycle["deploy / start / stop\nrestart / add / remove"]
    CLI --> health["health / logs / watchdog"]
    CLI --> secrets["secrets (14 subcommands)"]
    CLI --> nginx["nginx add / remove / list"]
    CLI --> git["git onboard / branch\ncommit / push / pr / release"]
    CLI --> deps["deps / deps scan / deps fix\ndeps config / deps ignore / deps init"]
    CLI --> freeze["freeze / unfreeze"]
    CLI --> mcp["mcp (MCP server)"]

    subgraph Core ["Core modules (src/core/)"]
        registry["Registry\n(data/registry.json)"]
        systemd["Systemd\n(systemctl)"]
        docker["Docker\n(docker compose)"]
        nginx_core["Nginx\n(/etc/nginx/)"]
        secrets_core["Secrets\n(age encrypt/decrypt)"]
        health_core["Health\n(systemd + HTTP checks)"]
        deps_core["Deps\n(npm / pip / Composer / OSV)"]
        git_core["Git\n(git + gh CLI)"]
    end

    lifecycle --> registry
    lifecycle --> systemd
    lifecycle --> docker
    health --> health_core
    health --> systemd
    nginx --> nginx_core
    secrets --> secrets_core
    deps --> deps_core
    git --> git_core
```

## Key paths

| Path | Purpose |
|------|---------|
| `data/registry.json` | App inventory — compose paths, domains, port, container names |
| `vault/*.age` | Encrypted secrets, one file per app |
| `/etc/fleet/age.key` | age private key (root-owned, mode 600) |
| `/run/fleet-secrets/` | Decrypted secrets at runtime (tmpfs, lost on reboot) |
| `/etc/fleet/notify.json` | Watchdog alert configuration (Telegram) |
| `/etc/systemd/system/<app>.service` | Generated systemd unit for each app |
| `/etc/nginx/sites-available/<domain>.conf` | Generated nginx server blocks |

## Secrets lifecycle

Secrets follow a one-way pipeline from vault to runtime, with the option to seal changes back:

```mermaid
sequenceDiagram
    participant vault as vault/*.age
    participant key as /etc/fleet/age.key
    participant runtime as /run/fleet-secrets/
    participant app as App containers

    Note over vault,key: On boot (fleet-unseal.service)
    vault->>key: age decrypt
    key->>runtime: write to tmpfs
    runtime->>app: bind-mounted env files

    Note over runtime,vault: When secrets change
    app->>runtime: edit env at runtime
    runtime->>vault: fleet secrets seal
    vault->>vault: age encrypt (backup first)
```

## fleet-bot (Go Telegram bot)

The `bot/` directory contains a separate Go program that provides remote server management through Telegram chat. It runs Claude Code sessions with access to fleet's MCP tools.

```mermaid
graph LR
    telegram["Telegram"]
    bot["fleet-bot\n(Go)"]
    claude["Claude Code\n(subprocess)"]
    mcp["fleet MCP server"]

    telegram --> bot
    bot --> claude
    claude --> mcp
    mcp --> |"systemctl / docker\nnginx / age"| server["Linux server"]
```

The bot runs as a systemd service and is built and deployed separately from the main CLI:

```bash
cd bot
make build
sudo cp fleet-bot /usr/local/bin/
sudo systemctl enable --now fleet-bot
```
