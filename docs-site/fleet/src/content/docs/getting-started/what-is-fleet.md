---
title: What is Fleet
description: Overview of the fleet project and what it does
---

Fleet is a production management CLI and MCP server for running Docker Compose applications on a single Linux server. It wraps systemd, nginx, age-encrypted secrets, GitHub workflows, and health monitoring into one consistent tool.

## What it does

- **Systemd orchestration** — Fleet generates a systemd service unit for each app so they start on boot in dependency order (databases first, then dependants). Start, stop, and restart operations go through `systemctl`.

- **Encrypted secrets vault** — Secrets are encrypted at rest with [age](https://github.com/FiloSottile/age) and stored as `.age` files. On boot, a systemd oneshot service (`fleet-unseal`) decrypts them to a tmpfs at `/run/fleet-secrets/` — they never touch persistent disk in plaintext.

- **MCP server for Claude Code** — Running `fleet mcp` starts a stdio-based Model Context Protocol server. Every fleet operation is exposed as a tool that Claude Code (or any MCP client) can call. Install it once with `fleet install-mcp`.

- **Multi-channel alerts** — The `fleet watchdog` command checks all services and sends alerts via Telegram or BlueBubbles (iMessage) when something is unhealthy. Designed to run on a cron schedule.

- **Dependency scanning** — Fleet scans all registered apps for outdated packages (npm, Composer, pip), Docker image updates, runtime EOL warnings, and security vulnerabilities (via OSV API). Results surface in the CLI, SSH MOTD, and alert notifications (Telegram or BlueBubbles).

- **TUI dashboard** — `fleet tui` launches an interactive terminal dashboard (Ink/React) showing all apps, their systemd state, container counts, and health.

- **Remote build runners** — `fleet_runner_*` MCP tools dispatch builds to a remote SSH host (e.g. a Mac Mini for iOS builds).

- **Mock servers** — `fleet mock` starts and manages local wiremock-ts dev servers for offline development.

- **Encrypted off-host backups** — `fleet backup` provides restic+age encrypted backups.

- **App Store audit** — `fleet audit` runs greenlight compliance scans for iOS apps targeting the App Store.

- **TestFlight publishing** — `fleet testflight` dispatches builds and manages TestFlight distribution.

- **Scheduled routines** — `fleet routines` provides a TUI for managing fleet-wide scheduled routines (signals grid + history).

## Security model

Fleet is built for single-operator, self-hosted use, and its bot and MCP daemon run with elevated privileges. Before exposing them, read the repository [`SECURITY.md`](https://github.com/wrxck/fleet/blob/main/SECURITY.md) for the threat model and the documented by-design impacts. In short:

- **The bot sender allowlist is the perimeter** — only trusted user IDs (`allowedSenderIds`) / phone numbers (`allowedNumbers`) should be authorised; the Telegram adapter default-denies and refuses to start on a group with no sender allowlist.
- **The secrets vault is tamper-evident** — the audit log is root-owned and append-only, never recording secret values.
- **The MCP daemon socket is group-gated** — membership of the `fleet-guard` group is what grants access.

## Who it is for

Fleet is for developers who self-host Docker Compose applications on a single server and want a consistent interface for deployment, secrets, monitoring, and GitHub workflows — without reaching for a full orchestration platform.
