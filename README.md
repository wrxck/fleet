<div align="center">

# fleet

**Docker production management CLI + MCP server**

[![CI](https://github.com/wrxck/fleet/actions/workflows/ci.yml/badge.svg)](https://github.com/wrxck/fleet/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/fleet-cli)](https://www.npmjs.com/package/fleet-cli)
[![Node](https://img.shields.io/node/v/fleet-cli)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.6-blue?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![License](https://img.shields.io/github/license/wrxck/fleet)](LICENSE)

Manages Docker Compose applications on a single server with systemd orchestration, nginx configuration, encrypted secrets, Git/GitHub workflows, health monitoring, and Telegram alerts.

</div>

---

## Architecture

```
fleet CLI (TypeScript/Node.js)
├── Commands          CLI interface (fleet <command>)
├── MCP Server        Claude Code integration (fleet mcp)
├── Registry          App inventory (data/registry.json)
├── Secrets Vault     age-encrypted secrets (vault/*.age)
└── Templates         systemd, nginx, gitignore generators

fleet-bot (Go)
└── Telegram bot that runs Claude Code sessions for remote management
```

### How it works

Each Docker Compose app is registered in fleet's registry with its compose path, service name, domains, port, and container names. Fleet generates a systemd service unit for each app so they start on boot in the correct order (databases first, then dependents). Secrets are encrypted at rest using [age](https://github.com/FiloSottile/age) and decrypted to a tmpfs at `/run/fleet-secrets/` on boot via a systemd oneshot service.

## Requirements

- Node.js 20+
- Docker + Docker Compose v2
- systemd
- nginx
- [age](https://github.com/FiloSottile/age) (for secrets)
- [gh](https://cli.github.com/) (for GitHub operations)

## Install

### From npm

```bash
npm install -g fleet-cli
```

### From source

```bash
git clone https://github.com/wrxck/fleet.git
cd fleet
npm install
npm run build
sudo npm link
```

### Install as Claude Code MCP server

```bash
sudo fleet install-mcp
```

This writes the MCP server config to `~/.claude.json` so all Claude Code sessions can use fleet tools. Alternatively, add manually:

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

## Usage

Fleet requires root for all commands except `mcp` and `install-mcp`.

```bash
fleet <command> [options]
```

### App lifecycle

```bash
fleet deploy <app-dir>          # Register, build, and start (full pipeline)
fleet add <app-dir>             # Register an existing app without deploying
fleet remove <app>              # Stop, disable, and deregister
fleet init                      # Auto-discover all existing apps on the server
```

`deploy` is the primary command -- it registers the app if needed, runs `docker compose build`, and starts/restarts the systemd service.

### Service control

```bash
fleet start <app>               # Start via systemctl
fleet stop <app>                # Stop via systemctl
fleet restart <app>             # Restart via systemctl
fleet logs <app> [-f]           # Container logs (follow mode with -f)
```

### Monitoring

```bash
fleet status                    # Dashboard: all apps, systemd state, containers, health
fleet list [--json]             # List registered apps
fleet health [app]              # Health checks: systemd + container + HTTP
fleet watchdog                  # Check all services, send Telegram alert on failure
```

`watchdog` is designed to run on a cron schedule. It checks systemd unit status, container state, and HTTP health endpoints, then sends a Telegram alert if anything is unhealthy. Configure Telegram credentials at `/etc/fleet/telegram.json`:

```json
{
  "botToken": "123456:ABC-DEF...",
  "chatId": "-100..."
}
```

### Nginx management

```bash
fleet nginx add <domain> --port <port> [--type proxy|spa|nextjs]
fleet nginx remove <domain>
fleet nginx list
```

Generates an nginx server block, writes it to `/etc/nginx/sites-available/`, symlinks to `sites-enabled/`, tests the config, and reloads nginx. Supports three config types:

- **proxy** -- reverse proxy to a backend port (default)
- **spa** -- static SPA with `try_files` fallback to `index.html`
- **nextjs** -- Next.js-specific proxy with static asset handling

### Secrets management

Fleet uses [age](https://github.com/FiloSottile/age) encryption for secrets at rest. Each app's secrets (`.env` files or secret directories) are encrypted as `.age` files in the `vault/` directory. On boot, a systemd oneshot service decrypts everything to `/run/fleet-secrets/` (tmpfs -- never touches disk).

```bash
fleet secrets init                          # Create age keypair, install unseal service
fleet secrets import <app> [path]           # Import .env or secrets dir into vault
fleet secrets export <app>                  # Print decrypted .env to stdout
fleet secrets list [app]                    # Show managed secrets (masked values)
fleet secrets set <app> <KEY> <VALUE>       # Set a single secret
fleet secrets get <app> <KEY>               # Print a single decrypted value
fleet secrets seal [app]                    # Re-encrypt from runtime back to vault
fleet secrets unseal                        # Decrypt vault to /run/fleet-secrets/
fleet secrets drift [app]                   # Detect vault vs runtime differences
fleet secrets restore <app>                 # Restore vault from backup
fleet secrets rotate                        # Generate new age key, re-encrypt everything
fleet secrets validate [app]                # Check compose env vars vs vault keys
fleet secrets status                        # Vault state, key counts, seal status
```

Two secret types are supported:
- **env** -- `.env` files (key=value pairs), encrypted as `<app>.env.age`
- **secrets-dir** -- directories of secret files (e.g. database passwords), encrypted as `<app>.secrets.age`

#### Vault safety features

All seal operations are protected with:
- **Automatic backups** -- vault files are backed up before any mutation
- **Pre-seal validation** -- rejects seal if >50% of keys would be removed (protects against accidental wipes)
- **Atomic rollback** -- backup is restored automatically if encryption fails
- **Drift detection** -- compare vault (survives reboot) vs runtime (lost on reboot) to catch unsaved changes

### Git and GitHub

Fleet can onboard apps to GitHub and manage their full Git workflow. All GitHub operations use `gh` CLI over HTTPS.

```bash
fleet git status [app]                      # Git state for one or all apps
fleet git onboard <app>                     # Create GitHub repo, push, protect branches
fleet git onboard-all                       # Onboard all registered apps
fleet git branch <app> <name> [--from dev]  # Create and push a feature branch
fleet git commit <app> -m "msg"             # Stage and commit changes
fleet git push <app>                        # Push current branch
fleet git pr create <app> --title "..."     # Create a pull request
fleet git pr list <app>                     # List open PRs
fleet git release <app>                     # Create develop -> main release PR
```

The `onboard` command handles everything: initialises git if needed, creates a private GitHub repo, pushes `main` and `develop` branches, and sets up branch protection rules.

### Global flags

```
--json       Output as JSON (where supported)
--dry-run    Show what would happen without making changes
-y, --yes    Skip confirmation prompts
-v           Show version
-h           Show help
```

## MCP Server

Running `fleet mcp` starts a stdio-based [Model Context Protocol](https://modelcontextprotocol.io/) server. This exposes all fleet operations as tools that Claude Code (or any MCP client) can call.

### Available tools (27)

| Tool | Description |
|------|-------------|
| `fleet_status` | Dashboard data for all apps |
| `fleet_list` | List registered apps with config |
| `fleet_start` | Start an app via systemctl |
| `fleet_stop` | Stop an app via systemctl |
| `fleet_restart` | Restart an app via systemctl |
| `fleet_logs` | Get container logs |
| `fleet_health` | Run health checks for one/all apps |
| `fleet_deploy` | Build and restart an app |
| `fleet_nginx_add` | Create nginx config for a domain |
| `fleet_nginx_list` | List nginx site configs |
| `fleet_register` | Register a new app in the fleet registry |
| `fleet_secrets_status` | Vault state and counts |
| `fleet_secrets_list` | List secrets (masked values) |
| `fleet_secrets_unseal` | Decrypt vault to runtime |
| `fleet_secrets_validate` | Check compose env vars vs vault |
| `fleet_secrets_set` | Set a single secret key/value |
| `fleet_secrets_get` | Get a single decrypted value |
| `fleet_secrets_seal` | Seal runtime changes back to vault |
| `fleet_secrets_drift` | Detect vault vs runtime drift |
| `fleet_secrets_restore` | Restore vault from backup |
| `fleet_git_status` | Git state for one/all apps |
| `fleet_git_onboard` | GitHub setup: repo, push, protect |
| `fleet_git_branch` | Create and push a feature branch |
| `fleet_git_commit` | Stage and commit changes |
| `fleet_git_push` | Push current branch |
| `fleet_git_pr_create` | Create a pull request |
| `fleet_git_pr_list` | List pull requests |
| `fleet_git_release` | Create develop -> main release PR |

## fleet-bot

A Go Telegram bot (`bot/`) that provides remote server management through chat. It runs Claude Code sessions, giving Claude access to fleet's MCP tools for hands-free operations.

Built and deployed separately:

```bash
cd bot
make build
sudo cp fleet-bot /usr/local/bin/
sudo systemctl enable --now fleet-bot
```

## Project structure

```
src/
├── index.ts                 Entry point (detects "mcp" arg)
├── cli.ts                   CLI router and help text
├── commands/                CLI command implementations
│   ├── add.ts               Register an app
│   ├── deploy.ts            Full deploy pipeline
│   ├── git.ts               Git/GitHub operations
│   ├── health.ts            Health checks
│   ├── init.ts              Auto-discover apps
│   ├── install-mcp.ts       Self-install as Claude Code MCP server
│   ├── list.ts              List apps
│   ├── logs.ts              Container logs
│   ├── nginx.ts             Nginx management
│   ├── remove.ts            Deregister app
│   ├── restart.ts           Restart service
│   ├── secrets.ts           Secrets vault management
│   ├── start.ts             Start service
│   ├── status.ts            Dashboard
│   ├── stop.ts              Stop service
│   └── watchdog.ts          Health monitor + Telegram alerts
├── core/                    Core logic
│   ├── docker.ts            Docker Compose operations
│   ├── errors.ts            Error types
│   ├── exec.ts              Shell execution helpers
│   ├── git.ts               Git operations
│   ├── git-onboard.ts       GitHub onboarding logic
│   ├── github.ts            GitHub API via gh CLI
│   ├── health.ts            Health check logic
│   ├── nginx.ts             Nginx file operations
│   ├── registry.ts          App registry (data/registry.json)
│   ├── secrets.ts           Vault primitives (age encrypt/decrypt, backup/restore)
│   ├── secrets-ops.ts       High-level secrets operations (safe seal, drift, validation)
│   ├── secrets-validate.ts  Compose vs vault validation
│   └── systemd.ts           systemctl operations
├── mcp/
│   ├── server.ts            MCP server setup + tool registration
│   ├── git-tools.ts         Git-related MCP tools
│   └── secrets-tools.ts     Secrets MCP tools (set, get, seal, drift, restore)
├── templates/
│   ├── gitignore.ts         .gitignore generator
│   ├── nginx.ts             Nginx config generator
│   ├── systemd.ts           systemd unit generator
│   └── unseal.ts            Unseal service generator
└── ui/
    ├── confirm.ts           Interactive confirmation
    └── output.ts            Coloured terminal output

bot/                         fleet-bot (Go Telegram bot)
data/                        Runtime data (registry.json)
vault/                       Encrypted secrets (*.age files)
```

## Development

```bash
npm run dev                  # Run with tsx (no build needed)
npm run build                # Compile TypeScript to dist/
npm test                     # Run tests with vitest
```

## License

MIT