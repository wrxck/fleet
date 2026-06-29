# Fleet — Security, Architecture & Reusability Audit

**Date:** 2026-06-24 · **Version audited:** 1.13.0 (`develop`) · **Scope:** full repo (~52k LOC TS/TSX, Go bot, Python guard, bash/python scripts)

**Method:** five parallel deep-dive passes (exec/privilege boundary, secrets subsystem, injection/network/bot, architecture, reusability) plus independent verification by the lead (exec surface scan, dependency tracing, CI/guard review, build+test baseline). Findings below are consolidated and de-duplicated across passes; where two passes independently flagged the same issue it is marked **[corroborated]**.

**Baseline health:** typecheck clean; **1889/1889 logic tests green** (the 23 initial failures were a `better-sqlite3` native-ABI mismatch under Node 24 — resolved by `npm rebuild`, not a code defect). No shell injection exists anywhere in the TypeScript surface — `exec.ts` is uniformly `spawnSync(cmd, args)` with arg arrays, zero `shell:true`, zero string-concatenated `exec()`.

---

## Executive summary

Fleet is a **well-built, security-conscious codebase**: no hand-rolled crypto (delegated to `age`/`systemd-creds`), fail-closed MCP tiers, a clean ports-and-adapters core, a strong typed-command registry pattern, and disciplined dependency choices (native `fetch`, `proper-lockfile`, `structuredClone`). The audit found **no remote unauthenticated RCE in the TypeScript surface**.

The real risk concentrates in **one place: the Telegram/BlueBubbles bot**, whose container is root-equivalent by design — so its *sender authorization* is the entire security perimeter, and that perimeter currently **defaults to allow**. That is the headline finding (C1). The remaining security items are argument-injection hardening, trust-boundary attribution (peer-creds), and output-scrubbing consistency. Architecture and reusability findings are about finishing an in-flight migration and removing duplication — no structural rewrites needed.

| Domain | Critical | High | Medium | Low/Info |
|---|---|---|---|---|
| Security | 2 | 5 | 8 | ~10 |
| Architecture | – | 2 | 5 | 6 |
| Reusability | – | – | 6 | (positives) |

---

# 1. Security findings

## CRITICAL

### SEC-C1 — Telegram bot sender-auth defaults to ALLOW → group members get root on the host
`bot/adapter/telegram.go:45-48`, `bot/router/router.go:85-95`, `bot/config/config.go:87-97`
`IsAuthorizedSender` returns `true` when `allowedSenderIDs` is empty, and the legacy `/etc/fleet/telegram.json` path only populates `AllowedChatIDs`, never the sender list. The only enforced gate becomes "is this chat allowlisted." If any allowlisted chat is a **group**, **every member** can issue commands — and the bot container runs `network_mode: host` with `docker.sock` and `$HOST_HOME` mounted rw, so `/sh --force <anything>` is arbitrary root execution on the host.
**Fix:** sender-auth default-**deny**; when `allowedSenderIDs` is empty, require `senderID == chatID` (operator-only private chat); refuse to start on a group chat ID without an explicit sender allowlist.

### SEC-C2 — BlueBubbles identity is a spoofable handle; webhook auth = one reused secret, no replay protection
`bot/adapter/bluebubbles.go:103-115,156-160,221`
The HMAC body signature is correct and fails closed, but the sender identity is `payload.Data.Handle.Address` from the request body (attacker-controlled to anyone who can sign). The signing key **is the BlueBubbles API password**, which is also echoed in every outbound API body and shared with the relay; there is **no nonce/timestamp**, so a captured webhook can be replayed. Under `network_mode: host` the loopback webhook is reachable by local processes/neighbor containers.
**Fix:** separate webhook-signing secret from the API password; add a signed timestamp+nonce and reject stale/replayed requests; treat handles as non-authenticating; firewall the loopback port.

## HIGH

### SEC-H1 — SSH `destination` argument injection → RCE on the fleet controller
`src/mcp/runner-tools.ts:21`, `src/adapters/runner/remote.ts:36`, `src/core/runners/probe.ts:56`, `src/core/runners/ssh.ts:12-17`
`fleet_runner_register` accepts any non-empty `destination`, stores it verbatim, and places it in the `ssh` argv with **no `--` terminator**. `ssh` parses leading-`-` tokens as options, so `-oProxyCommand=…` / `-oPermitLocalCommand=yes -oLocalCommand=…` runs an arbitrary command on the controller before connecting. (`HOST_ID` is validated; the dangerous `destination` is not.)
**Fix:** validate `destination` (`^[A-Za-z0-9._-]+@[A-Za-z0-9._-]+$` or alias form), reject leading `-`, and insert a literal `--` before `host.destination` in `remote.ts` and `probe.ts`. Apply equally to `identityFile`/`defaultCwd`.

### SEC-H2 — Bot `/claude` can read any host-home file and exfiltrate to chat/web
`bot/command/claude.go:131-150`, `bot/claude/session.go:237-264`
Good controls (argv prompt, env-scrubbed, tools limited to `Read,Glob,Grep,WebSearch,WebFetch`, no `--dangerously-skip-permissions`). Residual: working dir is the **rw-mounted host home**, so read-only tools can read SSH keys / `~/.claude` / `.env` and summarize to chat, and `WebFetch`/`WebSearch` are an exfil channel. Gated only by C1/C2.
**Fix:** run Claude in an empty read-only scratch dir, drop `WebFetch`/`WebSearch` from the chat-exposed allowlist, stop mounting host home rw.

### SEC-H3 — MCP root daemon & v2 secrets socket have no peer-credential check or per-principal attribution **[corroborated: exec + secrets passes]**
`src/mcp/daemon.ts:44-49,67-95`, `src/core/secrets-v2.ts:114-160,252-274`
Both privileged sockets authorize **purely by unix-group/file mode** — no `SO_PEERCRED`. Any process in `fleet-guard` reaches the full policy-allowed root tool surface; any process sharing the v2 socket's gid reads the app's entire secret set. The audit log records no peer uid/pid, so a multi-member group has **no attribution**. This is partly by-design (group membership ≈ root-equivalent — see §4) but the boundary is coarser and less auditable than it looks.
**Fix:** read `SO_PEERCRED` on accept; record uid/gid/pid in every audit entry; optionally pin the v2 socket to the single expected consumer uid from the manifest. Cleanest path: ship a real `.socket` unit with `SocketMode=0660`/`SocketGroup=` and systemd socket activation.

### SEC-H4 — Live `age`/`systemd-creds` stderr returned to MCP/CLI callers is never scrubbed
`src/mcp/redact.ts:3-4`, `src/mcp/secrets-tools.ts:48-53`, `src/core/secrets-ops.ts` (SecretsError builders)
`scrubForAudit` is applied only to the audit log; the **live** error returned to the model/user embeds raw `age` stderr verbatim. The authors already filter `AGE-SECRET-KEY-` in `secrets-v2-keypair.ts` and scrub the audit path — so this is an inconsistency that can surface key/identity fragments through `fleet_secrets_*` responses.
**Fix:** route all externally-returned `age`/`systemd-creds` stderr through a central scrubber (`ageExec()` wrapper) before embedding in `SecretsError`.

### SEC-H5 — Deploy webhook is more reachable than documented and ships a token inline in the unit
`deploy-webhook.cjs:17-19,40-117`, `deploy-webhook.service:8-12`
Binds `127.0.0.1:9876` but is reached by containers via the Docker bridge `172.17.0.1` — i.e. reachable by **every container on the default bridge**, not "localhost only." Auth is a single static bearer (timing-safe compared — good), app is allow-listed, and exec is argv (no injection), so blast radius is "redeploy an allow-listed app." The shipped `.service` puts the token inline via `Environment=` (credential-at-rest in a 0644 unit file).
**Fix:** bind strictly to loopback (document any bridge exposure explicitly), load the token via `LoadCredential=`/`EnvironmentFile=` (0600), add `NoNewPrivileges=yes`/`DynamicUser=yes`/`ProtectSystem=strict`; consider per-app HMAC payloads.

## MEDIUM

- **SEC-M1 — Argument-injection hardening (`--` separators + self-validation).** `[corroborated: exec + injection]` `gh pr create` in `src/core/github.ts:50-63` skips `assertBranch` (unlike `gitPush`/`gitCheckout`); `repo` is unvalidated in `createPullRequest`/`listPullRequests`/`protectBranch`. Bot commands (`restart.go`, `git.go`, `secrets.go`, `nginx.go`, `deps.go:168`, `guard.go`) pass user positionals with no `--`. Not shell injection (argv arrays) but option-injection into git/docker/fleet. **Fix:** insert literal `"--"` before first user positional everywhere; call `assertBranch`/`assertAppName` inside the github.ts functions; use resolved absolute binaries.
- **SEC-M2 — Root daemon trusts `registry.json` values without re-validation on load.** `src/core/registry.ts` (no mode on write, no re-validate on load) → `docker compose` `cwd`, systemd unit paths, `nsenter` targets. If the registry lives in a user-writable checkout, "edit registry" → "root runs docker build in my dir." **Fix:** re-run `assertAppName`/`assertServiceName`/absolute-confined `assertComposeFile` on load; store the daemon-trusted registry under a root-only path; write `0640 root:root`.
- **SEC-M3 — Runner registry loaded with no schema validation; `identityFile`/`defaultCwd` unconstrained.** `src/mcp/runner-tools.ts:23-24`, `src/core/runners/store.ts:14`. Feeds H1. **Fix:** validate destination/identityFile/cwd on both upsert *and* load; verify file ownership/mode.
- **SEC-M4 — Wholesale `process.env` inheritance into root subprocesses.** `src/core/exec.ts:18` merges overrides on top of full `process.env`; runner adapters forward `...process.env` to remote SSH shells. Latent leak channel, violates least-privilege. **Fix:** build child env from an explicit allowlist; never forward local env to remote hosts.
- **SEC-M5 — `get` path is unaudited.** `fleet_secrets_get` (MCP) and `secretsGet` (CLI) decrypt a value with no `auditLog` entry; the "we audit at the command layer" claim doesn't hold for `get`. **Fix:** add `auditLog({op:'get',…})` to both, matching `export`.
- **SEC-M6 — v1 secrets audit log is per-user, env-derived actor, not tamper-evident.** `src/core/secrets-audit.ts:38-43`. Lives under the invoking user's `$HOME` (deletable/rewritable); `getActor()` trusts spoofable `SUDO_USER`/`USER`. **Fix:** write to a fixed root-owned path (mirror the MCP daemon's `/var/log/...` `0640`); derive actor from `getuid()`/`/proc/self/loginuid`.
- **SEC-M7 — Bot `/secrets get` echoes cleartext into chat history; `/waf rate` accepts 0/negative.** `bot/command/secrets.go:148-174`, `bot/waf/config.go:204-216`. **Fix:** gate `/secrets` behind `fleet-guard` approval + short-TTL `--reveal`; bound WAF rate `>0` with sane caps; write WAF config `0640`.
- **SEC-M8 — `cf_block_ip` interpolates an unvalidated IP into a Cloudflare WAF expression.** `scripts/guard/fleet-guard-execute:131-143` builds `(ip.src eq {ip})` with no IP validation — ruleset-expression injection if the approval queue is writable. **Fix:** validate with `ipaddress` before interpolation. (Also: the executor uses a **global** CF API key — see §4.)

## LOW / INFO (security)

- **SEC-L1** — Dead socket-activation path + wrong hint: `connect.ts:22` tells users to start `fleet-mcp.socket`, but `generateMcpService()` never emits a `.socket` unit. Ship the unit (fixes H3/socket mode) or fix the hint.
- **SEC-L2** — Master-key rotation leaves `age.key.old` (a second valid private key) on a crash window; old-key-encrypted snapshots are retained indefinitely. Add a `doctor` check + prune/re-encrypt on rotation.
- **SEC-L3** — `scrubForAudit` redaction gaps: first-line-only; `DATABASE_URL=postgres://user:pass@…` doesn't match `SECRET_ASSIGN`; sub-32-char tokens slip `HIGH_ENTROPY`. Broaden to URL/URI/DSN/CONN + reuse provider regexes.
- **SEC-L4** — Unescaped HTML in Telegram/notify outbound (`parse_mode:HTML`) → garbled markup at worst, not RCE. Escape dynamic text.
- **SEC-L5** — `/claude stop` uses `pkill -f claude` (over-broad); `cloudflare.ts` passes CF token as `curl -H` arg (visible in `ps`); manifest parse failures silently fall back to empty (masks tampering). Minor hardening each.
- **SEC-L6** — `installServiceFile`/`credentialPathFor`/v2 migrate paths don't self-call `assertServiceName`/`assertAppName` (safe only because current callers pre-validate). Add the guards at the primitives.
- **SEC-L7** — Guard token comment says "256 bits" but is 112 bits (14 bytes) — ample, fix the comment.

---

# 2. Architecture findings

- **ARC-P1 (High) — Finish the `CommandDef` migration.** Two dispatch paths coexist (`cli.ts:132` typed registry vs `:205` legacy switch); 15 legacy commands (incl. the largest: `commands/secrets.ts` 928 LOC, `commands/backup.ts` 530) can't be unit-tested without spawning, aren't JSON-able, and don't auto-expose over MCP. **Make this the top maintainability priority**; add a test that fails if a new `commands/*.ts` calls `process.exit`.
- **ARC-P2 (High) — Unlocked registry RMW reachable from the daemon (lost-update race).** `src/core/git-onboard.ts:177` does a bare `load()→mutate→save()` outside `withRegistry()`, reachable from the long-lived MCP daemon concurrently with locked writers. **Fix:** wrap in `withRegistry()`.
- **ARC-P3 (Med) — Unwrapped `node:fs` drives a brittle-mock test culture.** 77 non-test files use raw sync `fs`; tests `vi.mock('node:fs')` per-function and assert mock mechanics even though a real env-override temp-dir seam (`FLEET_*_PATH`) already exists. **Standardize on the temp-dir seam; retire per-function fs mocks.**
- **ARC-P4 (Med) — Three notification subsystems.** `[corroborated: reuse]` `adapters/notifier/`, `core/notify.ts`, `core/telegram.ts` — two implement Telegram send separately. **Consolidate on `NotifierAdapter`.**
- **ARC-P5 (Med) — Non-atomic / inconsistently-locked secrets manifest writes.** `saveManifest` (`secrets.ts:117`) is a bare `writeFileSync`; `secrets-metadata.ts` mutates without `lockManifest`. **Make atomic (tmp+rename); audit standalone callers for an outer lock.**
- **ARC-P6 (Med) — Secrets v1/v2 duality needs a defined end-state** (18 modules / ~3,450 LOC). Resolve as a by-product of P1; set a deadline to remove v1 once v2 lands.
- **ARC-P7 (Med) — TUI re-implements orchestration** (`tui/routines/hooks/use-ops-fleet.ts` does raw `docker`/`nginx -t`/`df` parsing) instead of reusing `core/docker.ts`/`core/systemd.ts`. Route through core.
- **ARC-Low** — No linter / no standalone `typecheck` script (11 stray `eslint-disable` with no eslint configured); `git.ts:9-12` mutates `process.env.SSH_AUTH_SOCK` at import time (move to `initGitEnv()`); one unguarded TUI promise (`use-fleet-data.ts:25`); no async exec wrapper (runner adapters hand-roll `spawn`).
- **Genuinely good (keep):** the `CommandDef` registry + CLI↔MCP parity test; `process.exit`-free core (0 in core/adapters); `execSafe` single seam (199 sites); `proper-lockfile`; the `deps/` collector→scanner→reporter design; no global mutable state; only 4 `as any`, 0 `@ts-ignore`.

---

# 3. Reusability / dependency-burden findings

The codebase is already disciplined — TOTP, the node:http backup server, login-throttle, color/table, and `self-update` are **correctly hand-rolled; leave them**. Wins are in-repo dedup, almost no new packages.

- **REU-1 — Remove `chokidar@5.0.0`** — phantom prod dep, imported nowhere. (S, ~no risk)
- **REU-2 — Add `messageOf(e: unknown)` to `errors.ts`** — replaces ~73 copies of `e instanceof Error ? … : String(e)` and unsafe `(err as Error).message` casts (the casts are a latent bug on non-Error throws). (M, low risk — also a correctness fix)
- **REU-3 — Add `writeJsonAtomic()` / `readJson()`** — unifies 6 divergent atomic-write copies (only `registry.ts` fsyncs; the rest have weaker crash-durability) + ~26 inline JSON reads. (M, low–med)
- **REU-4 — Collapse tiny dup helpers** — `extractFlag` (×3), `humanBytes` (×2 + 4 inline), `sleep` (×2), and the **byte-identical `sendTelegram` (×2)**. (S, low)
- **REU-5 — Shared secrets primitives for v1/v2** — extract `age-crypto.ts` (`ageEncrypt`/`ageDecrypt`/`ageDecryptFile`), one `parseEnvMap`, one exported `resolveVaultDir()`; removes ~100 LOC and the risk of the two `age` wrappers drifting. (M, med — security-sensitive, keep tests green)
- **REU-6 (optional) — `semver` (pinned) for the dep-scanner's two partial version parsers** (`deps/severity.ts:45`, `collectors/docker-image.ts:150`) which ignore prerelease/`v`-prefix. Only if mis-severity on pre-release tags is actually observed. **Do not** add commander/yargs — the in-repo zod `parse-args.ts` is the right owned solution.
- **Dep health:** `wiremock-ts@0.1.1` correctly stays a prod dep (`fleet mock` uses it at runtime); `better-sqlite3`/`yaml` correctly used.

---

# 4. Dependency & process posture (lead's independent review)

- **npm audit: 6 vulns (3 high `ws`, moderate `qs`/`ip-address`/`express-rate-limit`) — all transitive and not on a reachable path.** `ws` ← `ink` (not network-exposed); `express`/`qs`/`ip-address`/`express-rate-limit` ← `@modelcontextprotocol/sdk@1.29.0` (already the latest) — fleet uses a custom `SocketServerTransport` over a unix socket and **never imports the express HTTP transport**. **Action:** document as unreachable; optionally add npm `overrides` to bump `ws`/`qs`/`ip-address` for a clean `npm audit`; revisit when the SDK ships a fix.
- **CI gaps:** no `npm audit`, no lint, no standalone typecheck, no secret-scan step; Node 24 (the dev machine) isn't in the `[20,22]` matrix though `engines` is `>=20`. Native-module ABI fragility surfaces here. **Action:** add `npm audit --omit=dev`, a linter, and a `typecheck` job; add Node 24 to the matrix or pin a supported range.
- **No `SECURITY.md` / threat-model doc** despite multiple by-design tradeoffs (below). **Action:** add one (the user explicitly wants by-design impact documented).

### By-design impacts to document explicitly (SECURITY.md)
1. **Bot container is root-equivalent** (`network_mode: host`, docker.sock, `$HOST_HOME` rw); the **sender allowlist is the entire perimeter** — and `/sh` is intentional arbitrary execution.
2. **`fleet-guard` group membership ≈ root-equivalent**; the MCP socket ACL is the boundary (the root daemon is intentionally un-sandboxed because it must drive systemctl/docker/nginx).
3. **v2 secrets socket authz = socket gid only** (no in-band auth); security depends on the gid having exactly one intended member and the mount not being shared.
4. **secrets-dir runtime files are world-readable (0644)**; host containment relies solely on the `0700` parent dir.
5. **`age.key.old` and old-key-encrypted snapshots persist** after master-key rotation.
6. **Guard executor uses a global Cloudflare API key** (`X-Auth-Key`) — broad blast radius (vs a scoped token).
7. **`dump.ts` `passwordHostCommand` is operator-trusted RCE-by-design** (backup config only, never network input).
8. **Backup explorer confidentiality depends on the nginx IP/Basic-Auth layer**, which the repo does **not** generate (hand-deployed) — a misdeploy exposing `127.0.0.1:4322` drops to TOTP-only.
9. **Egress hostname allowlist trusts attacker-controllable PTR records** (observe-only in v1; require forward-confirmed reverse DNS before enforcement ships).
10. **v1 secrets audit log is per-user with an env-derived actor** (not tamper-evident).

### Verified-safe (no action) — recorded so we don't re-litigate
Backup explorer HTTP server (path allowlists, `..` rejection, CSRF custom-header + exact-Origin, HMAC sessions w/ constant-time compare, RFC-6238 TOTP + throttle, header-injection-safe downloads, XSS-safe rendering); nginx generation (assertDomain, clamped port, hardcoded loopback upstream, static headers); SSH host-key verification **not** weakened (no `StrictHostKeyChecking=no`, `BatchMode=yes` fails closed); compose parsing reaches docker only as argv; `dump.ts`/`unlock.ts` `sh -c` builders are escaped (`shToken`/`shq`/`assertEnvName`); `gh` uses stored auth (no token on argv/URL); git remotes are SSH; bot router runs auth before every command and BlueBubbles is default-deny.

---

# 5. Proposed implementation plan (next release)

**Phase 0 — Baseline & guardrails (do first):** rebuild native module note in docs; add CI `npm audit`/lint/typecheck + Node 24; add a `process.exit`-in-`commands/*` lint guard. Write `SECURITY.md` capturing §4 by-design impacts.

**Phase 1 — Critical/High security (highest ROI):** SEC-C1 (Telegram default-deny) → SEC-C2 (BlueBubbles secret/replay/identity) → SEC-H1 (ssh `--` + destination validation) → SEC-H2/H3 (claude scratch-dir + drop web tools; peer-creds/`.socket` unit) → SEC-H4 (central age-stderr scrubber) → SEC-H5 (deploy webhook bind + credential).

**Phase 2 — Medium security hardening:** SEC-M1 (`--` separators + github.ts self-validation) · M2/M3 (registry + runner re-validation on load) · M4 (env allowlist) · M5/M6 (`get` audit + root-owned non-spoofable audit log) · M7 (`/secrets` + `/waf` bounds) · M8 (cf_block_ip IP validation) · SEC-L1 (ship `.socket` unit / fix hint).

**Phase 3 — Reusability/dedup (low-risk cleanup):** REU-1 (drop chokidar) · REU-2 (`messageOf`) · REU-3 (`writeJsonAtomic`) · REU-4 (collapse dup helpers) · REU-5 (shared age primitives).

**Phase 4 — Architecture (larger, can span releases):** ARC-P2 (lock git-onboard — small, do in Phase 2) · ARC-P5 (atomic manifest — Phase 2) · ARC-P4 (consolidate notify) · ARC-P1/P6 (continue CommandDef migration + secrets v1 sunset plan) · ARC-P3 (test-seam standardization) · ARC-P7 (TUI→core).

**Review & test process for each phase:** unit tests for every fix; targeted integration tests for the bot auth path, ssh arg-injection, and peer-creds; full `vitest run` + `tsc --noEmit` green gate; `/code-review` on the diff; manual verify of the bot allowlist and webhook on a scratch deploy before merge.

---

# 6. Remediation status (implemented 2026-06-24)

Branch `chore/audit-remediation-2026-06`, 14 commits. Gate: typecheck clean, build clean, `npm audit` 0 vulns (prod + dev), **TS 1935 tests pass**, bot suite + `go vet` pass.

**Done**
- **Phase 0:** CI gains Node 24 + a typecheck step + a prod-dependency `npm audit` gate; `overrides` pin patched transitive deps and dev-dep bumps clear the audit (0 vulns); `SECURITY.md` added (threat model + 10 by-design impacts + dep posture).
- **Phase 1 (all Critical/High):** SEC-C1 Telegram default-deny + group-chat startup guard; SEC-C2 BlueBubbles dedicated signing key + replay guard; SEC-H1 ssh destination validation + `--`; SEC-H3 `fleet-mcp.socket` (systemd-owned ACL, fixes the dead socket-activation path + wrong `connect.ts` hint); SEC-H4 live age/systemd-creds stderr scrubbing; SEC-H5 deploy-webhook credential loading + non-loopback warning. SEC-H2 (`/claude` reach) documented per the agreed "harden-where-cheap" scope.
- **Phase 2:** SEC-M1 github.ts self-validation; M2 registry load-time integrity warning; M3 runner registry validation on load; M5 audited `get` path; M6 root-owned audit log with a trusted uid; M7 `/waf` rate bounds; M8 `cf_block_ip` IP validation; ARC-P2 locked git-onboard write; ARC-P5 atomic manifest.
- **Phase 3:** REU-1 removed phantom `chokidar`; REU-3 four JSON writers onto `writeJsonAtomic`; REU-4 `extractFlag`/`sleep`/`sendTelegram` deduped; REU-2 `messageOf()` helper added (+ backup.ts converted).
- **Phase 4:** unguarded TUI poll rejection fixed; `git.ts` ssh-sock init named/testable.

**Deferred (documented, recommended as focused follow-up PRs)**
- **SEC-M4** — build subprocess env from an allowlist (changing the central `execSafe` default risks breaking git/gh/docker/systemctl/ssh; defence-in-depth, no demonstrated leak).
- **REU-2 full sweep** — ~36 remaining `(x as Error).message` casts + ~33 `instanceof` copies → `messageOf` (mechanical, the helper is in place).
- **REU-5** — consolidate the age encrypt/decrypt wrappers + `parseEnvMap` + `resolveVaultDir` shared between secrets v1/v2 (security-sensitive; do with full secrets-test coverage).
- **ARC-P1/P6** — finish the `CommandDef` migration of the 15 legacy commands and set a secrets-v1 sunset date.
- **ARC-P3** — standardise on the temp-dir test seam; retire per-function `vi.mock('node:fs')`.
- **ARC-P4 / P7** — consolidate the three notifiers on `NotifierAdapter`; route TUI orchestration through core.
- **Tooling** — add a linter (Biome, conservative config) + a `process.exit`-in-`commands/*` guard.

# 7. v1.14.0 upgrade notes (operator-facing)

- **Telegram bot now default-denies.** With no `allowedSenderIds`, only a private (1:1) operator chat is accepted; the bot **refuses to start** if an allowlisted chat is a group/channel and no `allowedSenderIds` is set. Action: set `allowedSenderIds` to your user id(s) if you use a group chat.
- **BlueBubbles:** set a dedicated `webhookSecret` (separate from the relay `password`) for inbound webhook verification; replayed/stale webhooks are now rejected.
- **Secrets audit log moved** from `~/.local/share/fleet/audit.jsonl` to `/var/log/fleet/secrets-audit.jsonl` (`FLEET_AUDIT_DIR` overrides). Old history is not migrated.
- **MCP install** now ships `fleet-mcp.socket`; `sudo systemctl start fleet-mcp.socket` is the correct start command. Re-run `sudo fleet mcp install`.
- **Deploy webhook:** move the token out of the unit's `Environment=` to `LoadCredential=` (the script reads `$CREDENTIALS_DIRECTORY/deploy-webhook-token`).
