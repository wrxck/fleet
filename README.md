<div align="center">

# fleet

[![audited by auto-audit](https://img.shields.io/badge/audited_by-auto--audit-6366f1?logo=github&logoColor=white)](https://auto-audit.hesketh.pro)

**Docker production management CLI + MCP server**

[![CI](https://github.com/wrxck/fleet/actions/workflows/ci.yml/badge.svg)](https://github.com/wrxck/fleet/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/@matthesketh/fleet)](https://www.npmjs.com/package/@matthesketh/fleet)
[![Node](https://img.shields.io/node/v/@matthesketh/fleet)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.6-blue?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![License](https://img.shields.io/github/license/wrxck/fleet)](LICENSE)

Manage Docker Compose apps on a single server -- systemd orchestration, nginx routing, age-encrypted secrets, health monitoring, dependency tracking, Git workflows, and an MCP server for AI-assisted operations.

[Documentation](https://fleet.hesketh.pro) -- [npm](https://www.npmjs.com/package/@matthesketh/fleet) -- [GitHub](https://github.com/wrxck/fleet)

</div>

---

## Architecture

```mermaid
graph TD
    CLI["fleet CLI"]
    TUI["TUI Dashboard"]
    MCP["MCP Server"]
    BOT["fleet-bot (Go)"]

    CLI --> Core
    TUI --> Core
    MCP --> Core
    BOT -->|"via MCP"| Core

    subgraph Core["Core Modules"]
        Registry["Registry"]
        Docker["Docker Compose"]
        Systemd["systemd"]
        Nginx["nginx"]
        Secrets["Secrets Vault"]
        Health["Health Checks"]
        Git["Git / GitHub"]
        Deps["Dependency Monitor"]
    end

    Docker --> Containers["Containers"]
    Systemd --> Services["systemd Services"]
    Nginx --> Proxy["Reverse Proxy"]
    Secrets --> Vault["vault/*.age"]
    Secrets --> Runtime["/run/fleet-secrets"]
    Health --> Alerts["Telegram / iMessage"]
```

Each Docker Compose app is registered with its compose path, domains, port, and container names. Fleet generates systemd units so apps start on boot in the correct order. Secrets are encrypted at rest with [age](https://github.com/FiloSottile/age) and decrypted to a tmpfs on boot.

## Install

```bash
npm install -g @matthesketh/fleet
```

Requires Node.js 20+, Docker Compose v2, systemd, nginx, and [age](https://github.com/FiloSottile/age). See the [full setup guide](https://fleet.hesketh.pro/getting-started/) for details.

## Key Features

**Deploy and manage apps** -- `fleet deploy <app-dir>` registers, builds, and starts an app in one command. Control services with `start`, `stop`, `restart`, and `logs`.

**Encrypted secrets** -- age-encrypted vault with automatic backups, pre-seal validation, drift detection, and atomic rollback. Decrypted to tmpfs at boot -- secrets never touch disk.

**Nginx routing** -- Generate proxy, SPA, or Next.js server blocks with `fleet nginx add`. Automatic config testing and reload.

**Health monitoring** -- Three-layer checks (systemd + container + HTTP) with `fleet health`. The `watchdog` command runs on cron and sends alerts on failure.

**Dependency scanning** -- Detects outdated packages, CVEs (via OSV), Docker image updates, and runtime EOL across all registered apps.

**Git workflows** -- Onboard apps to GitHub, manage branches, PRs, and releases from the CLI.

**Interactive dashboard** -- Run bare `fleet` to launch a full-screen TUI with real-time status.

See the [CLI reference](https://fleet.hesketh.pro/cli/) for the complete command list.

## Secrets Flow

```mermaid
graph LR
    Import["fleet secrets import"]
    Set["fleet secrets set"]

    Import --> Encrypt["age encrypt"]
    Set --> Encrypt

    Encrypt --> Vault["vault/*.age"]
    Vault -->|"boot / fleet secrets unseal"| Decrypt["age decrypt"]
    Decrypt --> Runtime["/run/fleet-secrets (tmpfs)"]
    Runtime -->|"env_file / secrets"| Containers["Docker Containers"]

    Runtime -->|"fleet secrets seal"| Encrypt
    Vault -.->|"drift detection"| Runtime
```

Secrets are imported or set individually, encrypted with age, and stored in the vault. On boot (or manually), they are decrypted to a tmpfs mount that Docker containers reference. Sealing writes runtime changes back to the vault. Drift detection compares vault vs runtime to catch unsaved changes.

## Deployment Flow

```mermaid
graph TD
    Deploy["fleet deploy app-dir"]
    Deploy --> Register{"Already\nregistered?"}
    Register -->|No| Add["Register app"]
    Register -->|Yes| Build
    Add --> Build["docker compose build"]
    Build --> Start{"Service\nrunning?"}
    Start -->|No| StartSvc["systemctl start"]
    Start -->|Yes| Restart["systemctl restart"]
    StartSvc --> Healthy["App deployed"]
    Restart --> Healthy
```

## Boot Refresh

On every systemd start — including reboots — Fleet pulls the latest code from GitHub and rebuilds the image if needed, before starting the container. The flow is entirely fail-safe: any failure at any step (dirty working tree, no remote, fetch error, non-fast-forward merge, build failure, or a 900-second wall-clock timeout) is logged and falls through to a plain `docker compose up` with the existing image. The container will always start.

**New commands**

| Command | Description |
|---------|-------------|
| `fleet boot-start <app>` | Entry point systemd now invokes (`ExecStart`). Runs refresh then `docker compose up`. Not typically run by hand. |
| `fleet rollback <app>` | Re-tags `<image>:fleet-previous` → `<image>:latest` and restarts the service. Fleet tags the previous image automatically before every build. |
| `fleet patch-systemd` | Rewrites `ExecStart` in all installed unit files to use `fleet boot-start`, sets `TimeoutStartSec=900`, and backs up originals to `<path>.service.bak`. |
| `fleet patch-systemd --rollback` | Restores all `.bak` unit files and runs `daemon-reload`. |

**Kill switch**

To disable boot refresh entirely — next `systemctl start` goes straight to `docker compose up`:

```bash
sudo touch /etc/fleet/no-auto-refresh
```

Remove the file to re-enable.

**Registry field: `lastBuiltCommit`**

Each app in the registry stores the Git commit that was last built. Fleet sets this on `fleet deploy` and on every successful boot-refresh build. Boot refresh skips `docker compose build` when HEAD already matches this value, keeping boots fast when no code has changed.

**First boot after upgrade**

Any app with `lastBuiltCommit` unset will trigger a full rebuild the first time it boots after upgrading to this version. Expect a longer first boot for those apps.

**Recovery escape hatches**

| Situation | Action |
|-----------|--------|
| One app misbehaving after a build | `fleet rollback <app>` |
| Registry corrupted | Auto-loads `.bak` on next read |
| Broad issue with boot-start behaviour | `sudo touch /etc/fleet/no-auto-refresh` |
| Worst case — revert all unit files | `fleet patch-systemd --rollback` |

## MCP Server

Fleet exposes 36 tools via the [Model Context Protocol](https://modelcontextprotocol.io/) for AI-assisted server management. Run `fleet mcp` to start the stdio server, or install it into Claude Code:

```bash
sudo fleet install-mcp
```

Tools cover the full surface area: app lifecycle, secrets, nginx, Git, health checks, and dependency monitoring. See the [MCP documentation](https://fleet.hesketh.pro/mcp/) for the complete tool list.

## fleet-bot

A Go companion bot (`bot/`) that provides remote server management through Telegram or iMessage. It runs Claude Code sessions with access to fleet's MCP tools for hands-free operations.

See the [bot documentation](https://fleet.hesketh.pro/bot/setup/) for setup instructions.

## Development

```bash
git clone https://github.com/wrxck/fleet.git
cd fleet
npm install
npm test          # vitest
npm run build     # compile TypeScript to dist/
npm run dev       # run with tsx (no build needed)
```

## License

MIT
