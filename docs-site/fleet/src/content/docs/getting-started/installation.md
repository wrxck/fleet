---
title: Installation
description: How to install fleet on your server
---

## Prerequisites

| Requirement | Notes |
|-------------|-------|
| Node.js 20+ | Fleet requires Node 20 or later |
| Docker + Docker Compose v2 | `docker compose` (not `docker-compose`) |
| systemd | Required for service management |
| nginx | Required for `fleet nginx` commands |
| [age](https://github.com/FiloSottile/age) | Required for secrets (`apt install age`) |
| [gh](https://cli.github.com/) | Required for Git/GitHub commands |

## Install from npm

```bash
npm install -g @matthesketh/fleet
```

Verify the installation:

```bash
fleet --version
```

## Install from source

```bash
git clone https://github.com/wrxck/fleet.git
cd fleet
npm install
npm run build
sudo npm link
```

## Privilege requirements

Fleet requires root for all commands that interact with systemd, nginx, or the secrets vault. The exceptions are `fleet mcp` and `fleet install-mcp`, which can run as any user.

Run fleet commands with `sudo` or as root:

```bash
sudo fleet status
sudo fleet deploy /srv/myapp
```

## MCP server setup

To install fleet as a Claude Code MCP server, run:

```bash
sudo fleet install-mcp
```

This writes the MCP server config to `~/.claude.json` so all Claude Code sessions can use fleet tools. Alternatively, add it manually:

```json
{
  "mcpServers": {
    "fleet": {
      "command": "fleet",
      "args": ["mcp"]
    }
  }
}
```

You can also start the MCP server directly for testing:

```bash
fleet mcp
```

The server communicates over stdio using the [Model Context Protocol](https://modelcontextprotocol.io/).
