# Changelog

Auto-generated from git tags. See https://github.com/wrxck/fleet/releases for the GitHub release notes with extra context.

## v1.13.0 — 2026-06-22

### Features

- feat(deploy): resolve an app name as well as a directory path
- feat(runner): fleet_runner_* MCP tools + registry and doctor
- feat(runner): remote build-host runner adapter over ssh
- feat(mock): add `fleet mock` to manage local wiremock-ts dev servers
- feat(mcp): enforce per-app allowlist for destructive tools
- feat(mcp): policy supports per-app { apps } tool rule
- feat(mcp): add scrubForAudit redactor for audit-log error text
- feat(mcp): prefer standalone install for daemon, warn on checkout
- feat(mcp): privilege-separated root daemon for unprivileged clients

### Fixes

- fix(mcp): audit isError results as failures and scrub persisted error text
- fix(mcp): redact before capping so a boundary secret can't survive truncation
- fix(mcp): unblock unprivileged agents — surface deploy errors, fix array tools, logs_recent, docs (#118)

### Other

- chore(release): 1.13.0
- docs: remove loose audit/plan/spec scratch files, keep README + CHANGELOG
- security: harden secrets MCP tier, self-update, backup login, dump shell, notify logs
- docs(mcp): document per-app allowlist for unprivileged agent deploy
- harden(mcp): null-proto policy map, precise deny reason, rate-limit test
- docs(plan): implementation plan for daemon security & safe agent deploy
- docs(spec): daemon security & safe agent deploy (v1.13.0 Spec A)
- chore(release): regenerate CHANGELOG for v1.12.0 (#119)
- test(mcp): assert the daemon negotiates the latest protocol version

## v1.12.1 — 2026-06-03

### Features

- feat(deploy): resolve an app name as well as a directory path

### Other

- chore(release): 1.12.1

## v1.12.0 — 2026-05-31

### Other

- Release v1.12.0 (#120)

## v1.11.1 — 2026-05-29

### Other

- chore(release): 1.11.1

## v1.11.0 — 2026-05-29

### Fixes

- fix(test): tolerate empty git tag list on shallow ci clones

### Other

- chore(release): 1.11.0 — gap-closing feature pass
- docs(readme): refresh + self-update channel selection

## v1.10.1 — 2026-05-29

### Other

- chore(release): 1.10.1 — code review follow-ups

## v1.10.0 — 2026-05-29

### Features

- feat(install-mcp): migrate install-mcp to a cliOnly registry CommandDef
- feat(boot-start): migrate boot-start to a cliOnly registry CommandDef
- feat(patch-systemd): migrate patch-systemd to a registry CommandDef
- feat(init): migrate init to a registry CommandDef
- feat(remove): migrate remove to a registry CommandDef
- feat(add): migrate add to a registry CommandDef
- feat(rollback): migrate rollback to a registry CommandDef
- feat(freeze): migrate freeze and unfreeze to registry CommandDefs
- feat(health): migrate health to a registry CommandDef
- feat(lifecycle): migrate start, stop and restart to registry CommandDefs
- feat(list): migrate list to a registry CommandDef
- feat(testflight): publish, build management and asc api integration
- feat(audit): suppress confirmed false positives via ignore rules
- feat(tui): open the command palette with the colon key
- feat(tui): add command palette view
- feat(tui): add schema-driven argument form
- feat(status): migrate status to a registry CommandDef
- feat(mcp): derive tools from the command registry
- feat(cli): add generic registry dispatcher with legacy fallthrough
- feat(audit): add app store compliance audit command via greenlight
- feat(registry): add registry assembly entrypoint
- feat(registry): add cli and mcp command context builders
- feat(registry): add zod-aware argv parser
- feat(registry): add render model to text renderer
- feat(registry): add command registry contracts and store

### Fixes

- fix(registry): support -y short flag in the argv parser
- fix(init): use discovered registry in the render rows
- fix(remove): handle the registry toctou race gracefully
- fix(mcp): validate command args against the schema in the bridge
- fix(tui): correct the palette key hint to arrow keys
- fix(tui): load the registry once and cover the command palette
- fix(audit): strip greenlight's stdout banner before parsing json
- fix(mcp): catch handler throws and guard structuredContent in bridge
- fix(mcp): add optional cliOnly field to BridgeTool interface
- fix(cli): handle --json as a global dispatcher flag
- fix(registry): handle readline close in cli confirm and test it
- fix(registry): reject unknown flags and missing flag values in parseArgs

### Other

- chore(release): 1.10.0
- test(registry): assert phase 2 command parity
- test(install-mcp): drop unused spyContext test helper
- test(boot-start): cover the failed-safe refresh branch and log levels
- test(patch-systemd): assert the rewritten unit-file content
- refactor(init): drop the dead finalReg fallback
- test(deploy): clarify the post-add registry-check test name
- test(rollback): assert the docker tag argv and registry-port image split
- test(health): tighten the single-app and http-render assertions
- refactor(testflight): build via a github actions macos runner
- test(registry): assert status actually renders in the parity test
- test(registry): assert status parity across all three surfaces
- test(tui): trim a stale comment in the palette tests
- chore(audit): gitignore the instance-specific audit cache
- test(status): assert the CommandDef table-row projection
- test(mcp): cover non-Error throw in the registry bridge handler
- test(audit): cover the greenlight audit command, core and mcp tools
- test(registry): isolate loadRegistry tests with a resettable loader
- test(registry): guard ragged table rows and add render edge cases
- refactor(registry): tie command args to schema via defineCommand

## v1.9.0 — 2026-05-29

### Features

- feat: operator identity config loader
- feat: requireEnv helper for fail-loud env vars
- feat(backup): serve + setup-totp subcommands
- feat(backup): http transport for the explorer service
- feat(backup): explorer spa + totp login page
- feat(backup): browser-api restore endpoint
- feat(backup): browser-api read endpoints (apps/snapshots/ls/file)
- feat(backup): browser-api router with totp session auth
- feat(backup): dumpFileSpawn for streaming file extraction
- feat(backup): lsTree for snapshot directory listing
- feat(backup): signed session cookies for the explorer
- feat(backup): rfc 6238 totp for the explorer
- feat(backup): sensitive-path classifier for the explorer
- feat(backup): read-only status dashboard at /backups
- feat(backup): rest backend with append-only and streaming dumps
- feat(secrets-v2): add gated integration test for end-to-end agent flow
- feat(secrets-v2): add install-v2 command for host agent + unit setup
- feat(client): add @matthesketh/fleet-secrets-client v0.1.0 package
- feat(secrets-v2): wire migrate-v2/revert-v2/cleanup-v2/status-v2 cmds
- feat(secrets-v2): add getV2Status reporting per-app v2 deployment state
- feat(secrets-v2): add detectV2Drift for consistency checks
- feat(secrets-v2): add cleanupV2Backups for retention-based snapshot pruning
- feat(secrets-v2): add revertAppFromV2 for v2-to-v1 rollback
- feat(secrets-v2): add migration orchestration with auto-rollback
- feat(secrets-v2): add systemd unit editor for agent dependency wiring
- feat(secrets-v2): add compose file editor for v2 migration
- feat(secrets-v2): add systemd templated-unit generator for fleet-secrets-agent
- feat(secrets-v2): add fleet-agent binary entrypoint
- feat(secrets-v2): add agent main() and arg parser, log chmod warnings
- feat(secrets-v2): add rate limiter, idle timeout, and linear header scan
- feat(secrets-v2): add GET /health endpoint with app and secret count
- feat(secrets-v2): add POST /refresh dispatch invoking deps.refresh
- feat(secrets-v2): add GET /secrets/<key> dispatch with key validation
- feat(secrets-v2): add GET /secrets dispatch returning all secrets
- feat(secrets-v2): add socket server skeleton with default 404 dispatch
- feat(secrets-v2): add agent core decryptVaultBlob primitive
- feat(secrets-v2): add systemd-creds wrapper for per-app credentials
- feat(secrets-v2): add reencryptForRecipient for per-app key migration
- feat(secrets-v2): add per-app age keypair generator
- feat(secrets-v2): add atomic snapshot/restore primitives for migration
- feat(secrets-v2): add HTTP/1.1 response writer
- feat(secrets-v2): add HTTP/1.1 request parser for unix socket protocol
- feat(secrets): add mode field to ManifestEntry for v2 socket support
- feat(deps): add osvSkipPatterns and 10s timeout to vulnerability scan
- feat(secrets): wrap manifest RMW callers in lockManifest
- feat(registry): wrap RMW callers in withRegistry
- feat(core): add inter-process file lock helper

### Fixes

- fix(tui): redaction toggle updates all visible list rows
- fix(tui): adopt ink-viewport 0.1.1 to eliminate scroll flicker
- fix: make rotateKey async-aware after #80 and #85 merge
- fix(backup): verifySession rejects non-object cookie payloads
- fix(bot): bind bluebubbles webhook to loopback only
- fix(secrets-v2): replace done callback with promise in hooks
- fix(secrets-v2): pass app+service args and use Scalar for seq inserts
- fix(secrets-v2): record ok:false on best-effort revert step failures
- fix(secrets-v2): harden migration orchestrator — async polling, socket race, rollback cleanup
- fix(secrets-v2): tighten arg-plumbing assertion + document trim caveat
- fix(secrets-v2): path-traversal guard, empty-plaintext + chmod safety
- fix(secrets-v2): use includes() for AGE key filter
- fix(secrets-v2): filter private key line from parse-failure error
- fix(secrets-v2): tighten snapshot perms, manifest format, listing
- fix(secrets-v2): measure request body in bytes, document caller bounds
- fix(tui): never preload secret values into editor state
- fix(secrets): per-op .bak filenames + atomic rollback for rotateKey
- fix(security): close systemd template -f argument injection
- fix(bot): harden claude exec path against chat-level RCE
- fix(bot/waf): validate whitelist IPs to prevent WAF bypass
- fix(bot): move bluebubbles password from url to body
- fix(routines): close systemd unit-file injection in routine schema
- fix(deps): preserve range prefix and precheck working tree in pr-creator
- fix(deploy-webhook): use spawnSync instead of undefined execSync

### Other

- chore(test): unblock CI for the 1.9.0 release
- chore(release): 1.9.0
- chore: re-apply extensionless imports and name scrub after #93 merge
- chore: replace operator home path with a generic default
- chore: replace private app names with generic placeholders
- refactor: operator username + domain from config
- refactor(backup): user-home pseudo-app with operator-derived paths
- refactor: route GitHub org through operator config, no hardcoded default
- chore: operator config template + gitignore the real file
- refactor(backup): assert cloudflare + vault-dir env vars
- refactor(backup): assert age key/script env vars instead of defaulting
- chore: drop .js suffixes from relative imports
- test(backup): use generic paths in the sensitive-path test
- refactor(backup): extract buildStatusReport into status.ts
- docs(secrets-v2): mark detectV2Drift socketPathOverride as test-only
- chore(ci): pin actions/setup-node to v4.4.0 SHA
- chore(ci): pin actions to SHAs, drop run-cleanup, gate publish on CI
- test(registry): add concurrency smoke for withRegistry
- chore(bot): remove dead handler tree and hardcoded chat-ID

## v1.8.1 — 2026-04-26

### Fixes

- fix(tui): eliminate scroll and load flicker

### Other

- chore(release): 1.8.1

## v1.8.0 — 2026-04-26

### Features

- feat(guard): per-zone policy editor for hold actions
- feat(bot): add streaming progress for long-running commands

### Other

- chore(release): 1.8.0

## v1.7.0 — 2026-04-26

### Features

- feat(cli): add `fleet guard` subcommand bundle (#61)
- feat(bot): add fleet-guard approval bridge commands (#60)

### Fixes

- fix(bot): wire callback_query + interactive /ssl renew + /deps fix (#64)

### Other

- release: 1.7.0 + fix bot fleetScript path (#65)

## v1.6.0 — 2026-04-26

### Features

- feat(logs+tui): multi-source CLI tail, TUI logs view, self-update banner
- feat(egress): observe outbound flows per app + MCP snapshot tool
- feat(logs): per-app policy, setup/status/prune, token-conservative MCP
- feat(secrets): optional UID/GID tightening for runtime secrets
- feat(secrets): MOTD reporter for stale secrets on shell login
- feat(secrets): add rollback + snapshots commands, wire audit + entropy
- feat(secrets): interactive rotation flow with snapshot, audit, rollback
- feat(secrets): add fleet secrets ages command
- feat(secrets): per-secret manifest metadata + provider registry

### Fixes

- fix(secrets): accept Stripe restricted keys (rk_live_...) for STRIPE_SECRET_KEY
- fix(tui): tighten health check + kill polling flicker
- fix(secrets): address all findings from independent code + security review
- fix(unseal): widen runtime perms to 0o644 for non-root containers
- fix(patch-systemd): dedupe targets so infra wins ExecStart carve-out
- fix(test): use process.cwd() so execGit integration tests work in CI

### Other

- refactor(tui): consume @matthesketh/ink-stable-state, bump to 1.6.0
- docs(site): document v1.6 secrets/logs/egress on fleet.hesketh.pro
- docs: add v1.6 sections to README — rotation, log lifecycle, egress
- test: add coverage for new modules (audit, snapshots, logs-policy, egress)
- chore(audit-fix): patch postcss + tsx, isolate test env from kill switch

## v1.5.0 — 2026-04-21

### Features

- feat(routines): scaffold wizard and settings reference tabs
- feat(routines): cost tab and incident timeline
- feat(routines): ops, security, and logs tabs
- feat(routines): repos drill-in, git tab, and @/ path alias
- feat(routines): mcp-call runner, webhook notifier, live-run panel
- feat(routines): routine-run CLI, CRUD, and command palette
- feat(routines): tab-based TUI with signals grid and routine detail
- feat(routines): add engine, signals collector, and default routines
- feat(routines): add core schema, storage, and adapter foundations
- feat(logs): add -c flag and mcp container arg for multi-container apps
- feat(docs): add client-side Mermaid diagram rendering via CDN
- feat(mcp): add fleet_rollback tool
- feat(patch-systemd): rewrite ExecStart, backup originals, --rollback flag
- feat(systemd): use fleet boot-start as ExecStart, bump timeout
- feat(deploy): record lastBuiltCommit after successful build
- feat(cli): register boot-start and rollback commands
- feat(cli): add fleet rollback command
- feat(cli): add fleet boot-start command with fail-safe refresh envelope
- feat(boot-refresh): refresh() with kill switch and wall-clock cap
- feat(boot-refresh): buildIfStale and recordBuiltCommit
- feat(boot-refresh): fastForward with --ff-only and abort on non-ff
- feat(boot-refresh): fetchOrigin with 60s timeout
- feat(boot-refresh): preflight checks for git/remote/branch/clean
- feat(docker): tag previous image as fleet-previous before build
- feat(registry): fsync before rename, preserve bak on corrupt main
- feat(registry): atomic write, .bak backup, corrupted-read fallback
- feat(registry): add lastBuiltCommit field to AppEntry
- feat(docs): add Docker deployment for fleet.hesketh.pro
- feat: require root for privileged commands, clear error message
- feat: bare 'fleet' command launches TUI dashboard
- feat(docs): scaffold Starlight docs site with full sidebar

### Fixes

- fix(build): run tsc-alias so @/ path imports resolve at runtime
- fix(routines): post-rebase type and boot-order test fixes
- fix(dependency-cve): Vulnerable dependency: @modelcontextprotocol/sdk (#41)
- fix(auth): BlueBubbles webhook has no authentication and bypasses bot (#39)
- fix(docs): extract Mermaid code from ec-line divs, not data-code attr
- fix(docs): target Expressive Code structure for Mermaid rendering
- fix(docs): rename .md to .mdx for pages using JSX imports
- fix(docs): serve 404 page instead of nginx 403 for section URLs
- fix(boot-refresh): run git with -c safe.directory for root-invoked refresh
- fix(patch-systemd): skip boot-start rewrite for databases service
- fix(boot-refresh): guard kill-switch existsSync against throw
- fix(docs): use laptop icon for CLI card, fix edit link to current branch
- fix(ci): remove workspace build step, add docker-compose project names
- fix: address peer review findings
- fix(security): validate secret keys, tighten dir perms, validate MCP inputs
- fix(tui): patch ink-scrollable-list flicker with MemoRow and stable refs
- fix: remove isFromMe filter for self-chat, portability fixes
- fix: make SSH_AUTH_SOCK configurable via FLEET_SSH_SOCK env var
- fix: remove hardcoded paths, make fleet portable for external users

### Other

- chore: merge main into develop (auto-audit badge, conflict resolution)
- chore(routines): sync package-lock to SDK 1.29.0 after rebase
- chore: add docs/superpowers, deploy-webhook, packages to gitignore
- chore: bump version to 1.5.0
- docs(site): add boot-refresh page
- docs(readme): document boot-refresh, rollback, kill switch
- test(boot-refresh): integration coverage for skip/fail-safe paths
- test(boot-refresh): integration harness for happy path
- docs: add auto-audit badge
- chore: switch ink-scrollable-list to npm 0.1.1, remove local patch
- test: commit previously untracked test files from earlier sessions
- test: add comprehensive tests for all commands and MCP tools
- test: add tests for commands, core, templates, TUI, and UI modules
- docs: complete all documentation pages
- docs: overhaul README with Mermaid diagrams and docs links
- docs(bot): add complete setup guide with config reference
- docs: add Getting Started, CLI Reference, and MCP Server pages
- test: add comprehensive tests for core modules with security scenarios
- chore: remove workspace packages (published to npm), fix service templates

## v1.4.0 — 2026-04-12

### Features

- feat(notify): pluggable notification layer replacing telegram-only watchdog
- feat(bot): restructure main.go for adapter/command/router architecture
- feat(bot): adapter-agnostic alert monitor with auto-freeze
- feat(bot): port all remaining commands to adapter-agnostic interface
- feat(bot): port fleet commands to command interface
- feat(bot): add BlueBubbles iMessage adapter
- feat(bot): add Telegram adapter
- feat(bot): add message router with selection state
- feat(bot): restructure config for multi-adapter support
- feat(bot): add adapter interface and message types
- feat(freeze): add freeze/unfreeze commands with MCP tools
- feat(systemd): add restart limit migration script

### Fixes

- fix(npm): restore @matthesketh scope for npm publishing
- fix(release): correct npm package name, mount bot.json, add specs
- fix(security): resolve remaining audit findings
- fix(review): update mcp description and composer regex
- fix(security): resolve all tech debt from code review
- fix(core): fix motd exit code and harden nginx docker validation
- fix(test): remove test skips in boot-order, let failures surface
- fix(core): eliminate command injection and harden vault handling

### Other

- chore: bump version to 1.4.0

## v1.2.0 — 2026-04-09

### Features

- feat(tui): integrate tabs, breadcrumb, new deps into fleet
- feat: add 12 more ink-* packages (phase 2)
- feat(tui): integrate ink packages into fleet
- feat: add wave 3 ink-* packages
- feat: add wave 2 ink-* packages
- feat: add wave 1 ink-* packages
- feat(tui): rewrite all views with input dispatcher and scrollable lists
- feat(tui): single input dispatcher, remove competing useInput
- feat: add @wrxck/ink-* packages for TUI overhaul
- feat(tui): add per-view selection indices to state

### Fixes

- fix(ci): build workspace packages in publish workflow
- fix(ci): build workspace packages before type-check
- fix(ink): polish ink packages and fix test failures

### Other

- chore: bump version to 1.2.0
- docs: add vitepress documentation site for all 30 ink packages
- test: add coverage for edge cases and untested props
- chore: rename package prefix @wrxck to @matthesketh
- chore(tui): wire up ink packages from workspace
- chore: add workspaces config for ink packages
- docs: add fleet deps to readme and fix mcp tool count

## v1.1.0 — 2026-03-28

### Features

- feat(deps): add mcp tools for dependency monitoring
- feat(deps): add fleet deps command with subcommands
- feat(deps): add pr creator actor for automated dependency updates
- feat(deps): add telegram reporter with deduplication
- feat(deps): add motd reporter with compact summary
- feat(deps): add cli reporter with summary and detail views
- feat(deps): add scanner orchestrator with concurrency and ignore rules
- feat(deps): add github pr collector for open dependency prs
- feat(deps): add vulnerability collector using osv api
- feat(deps): add eol collector for runtime lifecycle tracking
- feat(deps): add docker running collector for container drift
- feat(deps): add docker image collector for dockerfile/compose
- feat(deps): add pip collector for pypi packages
- feat(deps): add composer collector for packagist packages
- feat(deps): add npm collector for package freshness
- feat(deps): add severity assignment from version/eol/cvss
- feat(deps): add atomic cache read/write module
- feat(deps): add config module with defaults and merge
- feat(deps): add core type definitions

### Fixes

- fix(ci): remove provenance flag from npm publish

### Other

- chore(release): bump version to 1.1.0

## v1.0.0 — 2026-03-22

### Features

- feat(tui): add interactive terminal dashboard
- feat(secrets): vault backup, pre-seal validation, drift detection, MCP tools
- feat: inject build-time secrets and stricter unseal validation
- feat(mcp): add fleet_register tool for app registration
- feat(cli): add install-mcp command and comprehensive README

### Fixes

- fix(npm): publish as @matthesketh/fleet
- fix(npm): publish as fleet-cli (unscoped, @wrxck org doesn't exist on npm)
- fix(docs): remove CDATA wrapper from README
- fix(test): skip integration tests in CI (no systemd/server files)
- fix(ci): track package-lock.json for reliable CI builds
- fix(perf): batch systemd and docker queries to eliminate N+1 delays

### Other

- chore: prepare for public release on wrxck/fleet
- chore: initial commit — fleet CLI + fleet-bot
