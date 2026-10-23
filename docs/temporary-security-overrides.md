# Temporary security overrides

This file lists each dependency override that stands in for an upstream fix
that is not released yet. Each entry gives the removal trigger and the exact
removal steps. When the trigger is true, remove the override and delete the
entry from this file.

## docs-site: vite 6.4.5 under vitepress

- **Where:** the `overrides` block in `docs-site/package.json`.
- **Why:** vitepress 1.6.4 depends on `vite ^5.4.14`. The vite 5 line has no
  fix for these dev-server advisories:
  - GHSA-fx2h-pf6j-xcff, GHSA-587h-7wmj-h5pm (high)
  - GHSA-4w7w-66w2-5vf9, GHSA-v6wh-96g9-6wx3, GHSA-698v-4r3x-3vcv,
    GHSA-r825-w8mm-5pxw, GHSA-rq7h-c2jc-7f22, GHSA-9jrq-w75r-8gcw
  - GHSA-67mh-4wv8-2f99 (esbuild 0.21, through vite 5)
- **Effect:** vite 6.4.5 and esbuild 0.25.12 replace vite 5.4.21 and esbuild
  0.21.5 inside the vitepress tree only. `vitepress build` and `vitepress dev`
  both work.
- **Exposure without it:** local dev server only. The published docs image
  builds `docs-site/fleet` (astro) and serves static files.
- **Removal trigger:** a stable vitepress release depends on vite 6.4.4 or
  later. Check with:

  ```bash
  npm view vitepress@latest dependencies.vite
  ```

- **Removal steps:**

  ```bash
  cd docs-site
  # delete the "overrides" block from package.json, bump vitepress, then:
  npm install
  npm audit
  npm run build
  ```

  Remove the override in the same commit as the vitepress bump. If you keep it,
  it pins vite 6.4.5 under a vitepress that may need a later vite major.

## Advisories with no override

These have no fixed release, and no override can fix them in this repo.

- **braces GHSA-vfj7-8cjw-p6xm** (through `tsc-alias`, dev only): GitHub
  withdrew this advisory on 2026-09-18. `npm audit` can still report it from
  cached data. No action.
- **docker/docker GO-2026-4887 (CVE-2026-34040) and GO-2026-4883
  (CVE-2026-33997)** (through `bot/`): both faults are in the Docker daemon:
  the AuthZ plugin middleware and plugin privilege checks. The bot imports only
  `client` and `api/types`, which do not contain that code. `govulncheck` flags
  the whole module because the advisories list no symbols. Docker Engine 29.3.1
  fixes both. A host that runs no AuthZ plugin and has no installed plugin is
  not affected, as the advisories state. Check with:

  ```bash
  docker info --format '{{.Plugins.Authorization}}'   # expect []
  docker plugin ls -q | wc -l                         # expect 0
  ```

  Keep each host's engine at 29.3.1 or later. When a tagged module with the fix
  exists, bump `bot/go.mod`.
