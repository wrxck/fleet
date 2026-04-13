---
title: Using with Claude Code
description: How to use fleet through Claude Code via the MCP server
---

Once the fleet MCP server is installed (see [Setup](/mcp/setup)), Claude Code can manage your server by calling fleet tools directly. Here are practical examples.

## Deploy an app

> "Deploy the myapp application"

Claude will:
1. Call `fleet_status` to see the current state
2. Call `fleet_deploy` with `app: "myapp"`
3. Confirm success or surface the error

If the app is not yet registered, Claude can first call `fleet_register` with the compose path, then deploy.

---

## Check what is unhealthy

> "Check what's unhealthy on the server and tell me what to do"

Claude will:
1. Call `fleet_health` (no app parameter) to get health results for all apps
2. Identify any apps where `overall` is `down` or `degraded`
3. Call `fleet_logs` for each unhealthy app to look for errors
4. Suggest fixes based on the log output

---

## Set a secret

> "Set the DATABASE_URL secret for api to postgres://prod-host/mydb"

Claude will:
1. Call `fleet_secrets_status` to confirm the vault is initialised
2. Call `fleet_secrets_set` with `app: "api"`, `key: "DATABASE_URL"`, and the value
3. Remind you to unseal and restart the app for the change to take effect

If you want Claude to also apply it immediately:
1. `fleet_secrets_unseal` — decrypt the updated vault to runtime
2. `fleet_restart` with `app: "api"` — pick up the new env

---

## Create a pull request

> "Create a PR for the myapp feature branch I'm on"

Claude will:
1. Call `fleet_git_status` with `app: "myapp"` to get the current branch
2. Call `fleet_git_pr_create` with the app name, a draft title, and `base: "develop"`
3. Return the PR URL

For a full feature workflow:
1. `fleet_git_branch` — create a branch
2. Make code changes (using file editing tools)
3. `fleet_git_commit` — stage and commit
4. `fleet_git_push` — push to origin
5. `fleet_git_pr_create` — open the PR

---

## Investigate a dependency alert

> "What CVEs does myapp have and are any fixable?"

Claude will:
1. Call `fleet_deps_status` to see if scan data is current, or `fleet_deps_scan` to refresh
2. Call `fleet_deps_app` with `app: "myapp"` to get all findings
3. Filter for CVEs and check which have `fixable: true`
4. Optionally call `fleet_deps_fix` with `dryRun: true` to preview the PR changes
5. If you approve, call `fleet_deps_fix` with `dryRun: false` to create the PR
