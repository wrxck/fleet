---
title: Contributing
description: How to set up the development environment and contribute
---

import { Aside } from '@astrojs/starlight/components';

Fleet is a TypeScript CLI with a Go bot component. Here's how to set up the development environment.

## Prerequisites

- **Node.js** 20 or 22 (LTS)
- **npm** (comes with Node)
- **Go** 1.21+ (only needed for the bot)
- **Docker** and **Docker Compose** (for integration testing)

## Setup

```bash
git clone https://github.com/wrxck/fleet.git
cd fleet
npm install
npm run build
```

## Project structure

The TypeScript CLI lives in `src/`:

- `src/cli.ts` — argument parser and command routing
- `src/commands/` — one file per CLI command
- `src/core/` — business logic (docker, systemd, nginx, secrets, health, deps)
- `src/mcp/` — MCP server for Claude Code integration
- `src/tui/` — Ink/React terminal dashboard
- `src/templates/` — systemd, nginx, and unseal service templates
- `src/ui/` — terminal output helpers

The Go bot lives in `bot/`:

- `bot/main.go` — entry point
- `bot/adapter/` — messaging adapters (Telegram, BlueBubbles)
- `bot/handler/` — command routing and execution
- `bot/config/` — configuration loading

## Development commands

```bash
# Build TypeScript
npm run build

# Run tests
npm test

# Run a specific test file
npx vitest run src/core/health.test.ts

# Run in dev mode (tsx, no build step)
npm run dev -- status
```

## Code style

- TypeScript strict mode (`"strict": true` in tsconfig)
- ES modules (`"type": "module"`)
- Conventional commits: `feat(scope):`, `fix(scope):`, `test:`, `docs:`, `chore:`
- No default exports — use named exports everywhere

## Testing

Tests use [Vitest](https://vitest.dev/). See the [Testing guide](/dev/testing/) for patterns and conventions.

Key rules:
- Mock `node:child_process` and `node:fs` for unit tests — don't shell out or touch the filesystem
- Test both success and error paths
- Include security scenarios (injection, traversal, malformed input)
- Integration tests that need Docker/systemd skip in CI via `process.env.CI`

## Branch model

- **main** — production, updated via PR from develop
- **develop** — integration branch, features PR'd here
- **feat/\***, **fix/\***, **chore/\*** — working branches

All PRs target `develop`. Never push directly to main or develop.

<Aside>
See the full [Release process](/dev/release/) for how changes get from develop to main.
</Aside>

## CI

GitHub Actions runs on every push and PR:

1. Type-check (`tsc --noEmit`)
2. Test (`vitest run`)
3. Build (`tsc`)

Matrix: Node 20 and 22. Failed CI runs are auto-cleaned by a scheduled job.
