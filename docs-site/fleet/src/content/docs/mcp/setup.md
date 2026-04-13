---
title: MCP Server Setup
description: How to configure and run the fleet MCP server
---

Running `fleet mcp` starts a stdio-based [Model Context Protocol](https://modelcontextprotocol.io/) server. This exposes all fleet operations as tools that Claude Code (or any MCP client) can call.

## Install as Claude Code MCP server

The easiest way is to run:

```bash
sudo fleet install-mcp
```

This writes the MCP server entry to `~/.claude.json` so all Claude Code sessions on this machine can use fleet tools automatically.

## Manual configuration

Add this to your `~/.claude.json` (or `~/.config/claude/claude.json`):

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

## Run the MCP server directly

To start the server manually (for testing or use with another MCP client):

```bash
fleet mcp
```

The server communicates over stdin/stdout using the MCP protocol. It does not need root privileges to start, but individual tools that call `systemctl`, `docker`, or modify files under `/etc/` will fail unless fleet itself was installed with the necessary permissions.

## What the MCP server provides

The fleet MCP server exposes 35 tools grouped into five categories:

- **Fleet management** — status, list, start, stop, restart, deploy, logs, health, register, freeze, unfreeze
- **Nginx** — add config, list configs
- **Secrets** — status, list, set, get, unseal, seal, drift, validate, restore
- **Git** — status, onboard, branch, commit, push, pr create, pr list, release
- **Dependencies** — status, scan, app findings, fix, ignore, config

See the [Tools Reference](/mcp/tools) for the full list with parameters.

## Verify the connection

Once installed, open a Claude Code session and ask:

> What apps are registered in fleet?

Claude will call `fleet_list` and return the registry contents.
