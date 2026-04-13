---
title: CLI Overview
description: Overview of the fleet command-line interface
---

Fleet requires root for all commands except `mcp` and `install-mcp`.

```bash
fleet <command> [options]
```

## Command reference

| Command | Description |
|---------|-------------|
| `status` | Dashboard: all apps, systemd state, containers, health |
| `list [--json]` | List registered apps |
| `deploy <app-dir>` | Full pipeline: register, build, start |
| `start <app>` | Start app via systemctl |
| `stop <app>` | Stop app via systemctl |
| `restart <app>` | Restart app via systemctl |
| `logs <app> [-f]` | Container logs (follow mode with `-f`) |
| `health [app]` | Health checks (systemd + container + HTTP) |
| `add <app-dir>` | Register existing app without deploying |
| `remove <app>` | Stop, disable, and deregister an app |
| `freeze <app>` | Stop, disable, and mark an app frozen |
| `unfreeze <app>` | Clear frozen state and restart |
| `nginx add <domain>` | Create nginx server block |
| `nginx remove <domain>` | Remove nginx server block |
| `nginx list` | List nginx site configs |
| `secrets init` | Initialise age vault and unseal service |
| `secrets list [app]` | Show managed secrets (masked values) |
| `secrets set <app> <KEY> <VAL>` | Set a secret |
| `secrets get <app> <KEY>` | Print decrypted value |
| `secrets import <app> [path]` | Import .env or secrets directory into vault |
| `secrets export <app>` | Print full decrypted .env to stdout |
| `secrets seal [app]` | Re-encrypt runtime secrets back to vault |
| `secrets unseal` | Decrypt vault to /run/fleet-secrets/ |
| `secrets rotate` | Generate new age key, re-encrypt everything |
| `secrets validate [app]` | Check compose secrets vs vault |
| `secrets drift [app]` | Detect vault vs runtime differences |
| `secrets restore <app>` | Restore vault from backup |
| `secrets status` | Vault state and counts |
| `git status [app]` | Git state for one or all apps |
| `git onboard <app>` | Create GitHub repo, push, protect branches |
| `git onboard-all` | Onboard all apps |
| `git branch <app> <name>` | Create and push a feature branch |
| `git commit <app> -m "msg"` | Stage and commit changes |
| `git push <app>` | Push current branch |
| `git pr create <app>` | Create a pull request |
| `git pr list <app>` | List open pull requests |
| `git release <app>` | Create develop -> main release PR |
| `deps [app]` | Dependency health dashboard |
| `deps scan` | Run fresh dependency scan |
| `deps fix <app>` | Create PR for fixable dependency updates |
| `deps config` | Show or set configuration |
| `deps ignore <pkg>` | Suppress a finding |
| `deps init` | Install cron + MOTD for automated scanning |
| `watchdog` | Health check all services, alert on failure |
| `init` | Auto-discover all existing apps on the server |
| `tui` | Interactive terminal dashboard |
| `install-mcp` | Install fleet as Claude Code MCP server |
| `mcp` | Start as MCP server |
| `patch-systemd` | Add StartLimitBurst/StartLimitIntervalSec to all service files |

## Global flags

| Flag | Description |
|------|-------------|
| `--json` | Output as JSON (where supported) |
| `--dry-run` | Show what would happen without making changes |
| `-y`, `--yes` | Skip confirmation prompts |
| `-v`, `--version` | Show version |
| `-h`, `--help` | Show help |
