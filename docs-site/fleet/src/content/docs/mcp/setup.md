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

The fleet MCP server exposes **52 tools** grouped into **nine** categories:

- **Fleet management** — status, list, start, stop, restart, deploy, rollback, health, register, freeze, unfreeze
- **Logs / egress** — logs (deprecated), logs\_recent, logs\_summary, logs\_search, logs\_status, egress\_snapshot
- **Nginx** — add config, list configs
- **Secrets** — status, list, set, get, unseal, seal, drift, validate, restore
- **Git** — status, onboard, branch, commit, push, pr create, pr list, release
- **Dependencies** — status, scan, app findings, fix, ignore, config
- **Audit** — run, status, ignore, guidelines
- **TestFlight** — builds, doctor
- **Remote runners** — list, status, register, remove

See the [Tools Reference](/mcp/tools) for the full list with parameters.

## Tier model and access control

Every tool has a **tier** that determines whether the privilege-separated daemon allows it by default:

| Tier | Default | Rate limit | Description |
|------|---------|------------|-------------|
| `read` | allow | unlimited | Observes state; never changes anything |
| `secret` | **deny** | 10/min | Returns a decrypted secret value — opt-in required |
| `mutate` | allow | 60/min | Changes vault, registry, or config state |
| `destructive` | **deny** | 10/min | Restarts services, pushes outward, rotates keys |

`read` and `mutate` tools work without any policy file. `secret` and `destructive` tools are blocked by default — the operator must opt them in via `/etc/fleet/mcp-policy.json`.

> **`fleet_secrets_get` is `secret` tier.** Unlike all other listing/status tools, it returns a decrypted plaintext value and is **denied by default** under the daemon. Add it to `mcp-policy.json` to enable it.

## Privilege-separated daemon (socket activation)

The tier policy is enforced by a privilege-separated daemon installed with:

```bash
sudo fleet mcp install
```

This installs two systemd units:

- `fleet-mcp.socket` — owns the listening socket at `/run/fleet-mcp/mcp.sock`. systemd creates it with `root:fleet-guard` ownership and mode `0660`, so **only members of the `fleet-guard` group can connect**. This ACL is the access boundary, and systemd owns it (there is no listen-then-`chmod` race).
- `fleet-mcp.service` — the daemon itself, started via the socket (`Requires=`/`After=fleet-mcp.socket`).

Enable and start it with:

```bash
sudo systemctl enable --now fleet-mcp.socket
```

A client connects over `/run/fleet-mcp/mcp.sock` (see the `connect` hint if the daemon is not running: `sudo systemctl start fleet-mcp.socket`).

> **Upgrading from before v1.14.0:** re-run `sudo fleet mcp install` to install the new `fleet-mcp.socket` unit. This is distinct from `fleet install-mcp` above, which only registers fleet as an MCP server in `~/.claude.json`.

## Policy file (`/etc/fleet/mcp-policy.json`)

Create `/etc/fleet/mcp-policy.json` to override default tier behaviour. A partial file is valid — unspecified keys inherit the defaults shown above.

```json
{
  "tiers": {
    "read": "allow",
    "secret": "deny",
    "mutate": "allow",
    "destructive": "deny"
  },
  "tools": {
    "fleet_deploy":  { "apps": ["my-app"] },
    "fleet_restart": { "apps": ["my-app"] },
    "fleet_start":   { "apps": ["my-app"] },
    "fleet_stop":    { "apps": ["my-app"] }
  },
  "rateLimits": {
    "read": 0,
    "secret": 10,
    "mutate": 60,
    "destructive": 10
  }
}
```

The `tools` block supports three rule forms per tool:

- `"allow"` — always permit regardless of tier default.
- `"deny"` — always block regardless of tier default.
- `{ "apps": ["name1", "name2"] }` — **app-scoped**: only permit the tool when the `app` argument matches a name in the list. A destructive tool set to `{ "apps": [...] }` is allowed for those apps only; every other app is still blocked.

After editing the file, restart the daemon:

```bash
sudo systemctl restart fleet-mcp
```

A worked example is in [`data/mcp-policy.example.json`](https://github.com/wrxck/fleet/blob/main/data/mcp-policy.example.json).

## Audit log

Every tool call — allowed or denied — is appended as a JSON line to `/var/log/fleet-mcp/audit.log`. The log is created automatically (directory mode `0750`, file mode `0640`).

Each entry contains:

```json
{
  "ts": "2026-01-01T00:00:00.000Z",
  "tool": "fleet_deploy",
  "tier": "destructive",
  "outcome": "allow",
  "durationMs": 1234,
  "args": { "app": "my-app" }
}
```

Secret argument values are redacted to `[redacted]` before writing. Tool results are never logged.

## Verify the connection

Once installed, open a Claude Code session and ask:

> What apps are registered in fleet?

Claude will call `fleet_list` and return the registry contents.
