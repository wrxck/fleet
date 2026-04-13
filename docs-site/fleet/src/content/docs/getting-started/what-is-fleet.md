---
title: What is Fleet
description: Overview of the fleet project and what it does
---

Fleet is a production management CLI and MCP server for running Docker Compose applications on a single Linux server. It wraps systemd, nginx, age-encrypted secrets, GitHub workflows, and health monitoring into one consistent tool.

## What it does

- **Systemd orchestration** — Fleet generates a systemd service unit for each app so they start on boot in dependency order (databases first, then dependants). Start, stop, and restart operations go through `systemctl`.

- **Encrypted secrets vault** — Secrets are encrypted at rest with [age](https://github.com/FiloSottile/age) and stored as `.age` files. On boot, a systemd oneshot service (`fleet-unseal`) decrypts them to a tmpfs at `/run/fleet-secrets/` — they never touch persistent disk in plaintext.

- **MCP server for Claude Code** — Running `fleet mcp` starts a stdio-based Model Context Protocol server. Every fleet operation is exposed as a tool that Claude Code (or any MCP client) can call. Install it once with `fleet install-mcp`.

- **Multi-channel alerts** — The `fleet watchdog` command checks all services and sends alerts via Telegram when something is unhealthy. Designed to run on a cron schedule.

- **Dependency scanning** — Fleet scans all registered apps for outdated packages (npm, Composer, pip), Docker image updates, runtime EOL warnings, and security vulnerabilities (via OSV API). Results surface in the CLI, SSH MOTD, and Telegram notifications.

- **TUI dashboard** — `fleet tui` launches an interactive terminal dashboard (Ink/React) showing all apps, their systemd state, container counts, and health.

## Who it is for

Fleet is for developers who self-host Docker Compose applications on a single server and want a consistent interface for deployment, secrets, monitoring, and GitHub workflows — without reaching for a full orchestration platform.
