---
title: Release Process
description: How fleet versions are tagged, published, and deployed
---

import { Aside } from '@astrojs/starlight/components';

Fleet follows a structured release process from feature branches through to npm publication and production deployment.

## Version scheme

Fleet uses [semver](https://semver.org/):

- **Major** (2.0.0) — breaking changes to CLI interface or config format
- **Minor** (1.5.0) — new features, new commands, new MCP tools
- **Patch** (1.4.1) — bug fixes, security patches, doc updates

The version lives in `package.json` and is the single source of truth.

## Release workflow

### 1. Accumulate features on develop

Features are merged to `develop` via pull requests from `feat/*` branches. Each PR is reviewed before merge.

### 2. Prepare the release

When enough features have accumulated:

```bash
# On develop, bump the version
npm version minor  # or major/patch

# This updates package.json and creates a git tag
```

### 3. Create a GitHub release

```bash
# Push the tag
git push origin v1.5.0

# Create the release on GitHub
gh release create v1.5.0 --title "v1.5.0" --generate-notes
```

### 4. npm publish (automated)

The `publish.yml` GitHub Action triggers on release creation:

1. Checks out the tagged commit
2. Installs dependencies
3. Builds TypeScript
4. Publishes to npm as `@matthesketh/fleet`

The action requires the `NPM_TOKEN` secret configured in the repository.

### 5. Merge to main

After the release is published:

```bash
# Create PR from develop to main
gh pr create --base main --head develop --title "Release v1.5.0"
```

Main is updated only through these release PRs.

## Package contents

The npm package includes only what's in the `files` field of `package.json`:

- `dist/` — compiled JavaScript
- `data/registry.example.json` — example registry file
- `LICENSE`
- `README.md`

Source TypeScript, tests, docs site, and the Go bot are excluded.

## Post-release

After publishing:

1. Verify the package installs correctly: `npm install -g @matthesketh/fleet@latest`
2. Run `fleet --version` to confirm
3. Deploy to production servers: `npm update -g @matthesketh/fleet`

<Aside>
The Go bot has its own release cycle — it's built and deployed as a Docker image, not through npm.
</Aside>

## Hotfix process

For urgent fixes that can't wait for a normal release:

```bash
git checkout -b fix/critical-bug develop
# make the fix, test, commit
git checkout develop && git merge fix/critical-bug
npm version patch
# follow normal release steps
```
