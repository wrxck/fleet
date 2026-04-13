---
title: Git
description: Git and GitHub operations for fleet apps
---

Fleet provides Git and GitHub workflow management for registered apps. All GitHub operations use the `gh` CLI over HTTPS.

:::note[Onboarding required]
Most `fleet git` subcommands (branch, commit, push, pr, release) require the app to be onboarded first with `fleet git onboard`.
:::

---

## fleet git status

Show the git state for one or all apps.

### Usage

```bash
fleet git status [app] [--json]
```

### Arguments

| Argument | Required | Description |
|----------|----------|-------------|
| `app` | No | App name. Omit for all apps. |

### Examples

```bash
$ fleet git status
Git Status (3 apps)

APP      BRANCH    STATE     ONBOARDED
myapp    main      clean     yes
api      develop   dirty     yes
worker   -         no git    no
```

```bash
$ fleet git status myapp
Git: myapp
  root: /srv/myapp
  initialised: true
  branch: main | branches: main, develop
  remote: https://github.com/org/myapp.git
  clean: true
  onboarded: 2025-01-15T10:00:00.000Z
```

### Related

- **MCP tool:** `fleet_git_status`

---

## fleet git onboard

Create a GitHub repository for an app, push the code, and configure branch protection rules.

### Usage

```bash
fleet git onboard <app> [--dry-run] [-y]
```

### Arguments

| Argument | Required | Description |
|----------|----------|-------------|
| `app` | Yes | App name |

### Flags

| Flag | Description |
|------|-------------|
| `--dry-run` | Show the onboarding plan without making changes |
| `-y`, `--yes` | Skip confirmation prompt |

### Examples

```bash
$ fleet git onboard myapp --dry-run
Onboard plan: myapp (fresh-repo)
  root: /srv/myapp
  1. git init
  2. Create .gitignore
  3. gh repo create org/myapp --private
  4. Push main branch
  5. Create and push develop branch
  6. Enable branch protection on main and develop
dry run - no changes made
```

```bash
$ fleet git onboard myapp -y
Onboarded: myapp
  ✓ Initialised git repo
  ✓ Created GitHub repo
  ✓ Pushed main and develop
  ✓ Branch protection enabled
  repo: https://github.com/org/myapp
```

### Related

- **MCP tool:** `fleet_git_onboard`

---

## fleet git onboard-all

Onboard all apps that have not yet been onboarded to GitHub.

### Usage

```bash
fleet git onboard-all [--dry-run] [-y]
```

---

## fleet git branch

Create a feature branch from a base branch and push it to origin.

### Usage

```bash
fleet git branch <app> <name> [--from <branch>]
```

### Arguments

| Argument | Required | Description |
|----------|----------|-------------|
| `app` | Yes | App name |
| `name` | Yes | New branch name |

### Flags

| Flag | Description |
|------|-------------|
| `--from <branch>` | Base branch to create from (default: `develop`) |

### Examples

```bash
$ fleet git branch myapp feat/new-feature
✓ created and pushed branch feat/new-feature from develop
```

```bash
$ fleet git branch myapp fix/bug --from main
✓ created and pushed branch fix/bug from main
```

### Related

- **MCP tool:** `fleet_git_branch`

---

## fleet git commit

Stage all tracked changes and commit.

### Usage

```bash
fleet git commit <app> -m "message" [--dry-run]
```

### Arguments

| Argument | Required | Description |
|----------|----------|-------------|
| `app` | Yes | App name |

### Flags

| Flag | Description |
|------|-------------|
| `-m "message"` | Commit message (required) |
| `--dry-run` | Show what would be committed without writing |

### Examples

```bash
$ fleet git commit myapp -m "feat: add new endpoint"
✓ committed: feat: add new endpoint
```

### Related

- **MCP tool:** `fleet_git_commit`

---

## fleet git push

Push the current branch to origin.

### Usage

```bash
fleet git push <app> [--dry-run]
```

### Arguments

| Argument | Required | Description |
|----------|----------|-------------|
| `app` | Yes | App name |

### Examples

```bash
$ fleet git push myapp
✓ pushed feat/new-feature
```

### Related

- **MCP tool:** `fleet_git_push`

---

## fleet git pr create

Create a pull request on GitHub from the current branch.

### Usage

```bash
fleet git pr create <app> --title "..." [--base <branch>] [--dry-run]
```

### Arguments

| Argument | Required | Description |
|----------|----------|-------------|
| `app` | Yes | App name |

### Flags

| Flag | Description |
|------|-------------|
| `--title "..."` | PR title (required) |
| `--base <branch>` | Target branch (default: `develop`) |
| `--dry-run` | Show what would be created |

### Examples

```bash
$ fleet git pr create myapp --title "feat: add new endpoint"
✓ created PR #42: https://github.com/org/myapp/pull/42
```

### Related

- **MCP tool:** `fleet_git_pr_create`

---

## fleet git pr list

List open pull requests for an app.

### Usage

```bash
fleet git pr list <app> [--json]
```

### Arguments

| Argument | Required | Description |
|----------|----------|-------------|
| `app` | Yes | App name |

### Examples

```bash
$ fleet git pr list myapp
Pull Requests: myapp (2 open)

PR    TITLE                  BRANCHES                    URL
#42   feat: new endpoint     feat/new-endpoint -> dev    https://...
#40   fix: bug fix           fix/bug -> develop          https://...
```

### Related

- **MCP tool:** `fleet_git_pr_list`

---

## fleet git release

Create a pull request from `develop` to `main` (release PR).

### Usage

```bash
fleet git release <app> [--title "..."] [--dry-run]
```

### Arguments

| Argument | Required | Description |
|----------|----------|-------------|
| `app` | Yes | App name |

### Flags

| Flag | Description |
|------|-------------|
| `--title "..."` | PR title (default: `Release: <app>`) |
| `--dry-run` | Show what would be created |

### Examples

```bash
$ fleet git release myapp
✓ created release PR #50: https://github.com/org/myapp/pull/50
```

```bash
$ fleet git release myapp --title "Release v1.2.0"
✓ created release PR #50: https://github.com/org/myapp/pull/50
```

### Related

- **MCP tool:** `fleet_git_release`
