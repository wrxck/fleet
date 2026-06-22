# Fleet Security Audit

_Scope: full codebase — MCP server + privilege-separated root daemon, age-encrypted
secrets (v1 + v2 agent), backup/restore HTTP server, config templating, self-update,
and outbound integrations. This document records the findings and the remediations
applied in the same change._

## Summary

Fleet is a security-conscious codebase. The core process-execution layer
(`core/exec.ts`) uses `spawnSync` with **argument arrays** (never `shell: true`),
input validation (`core/validate.ts`) is applied as defence-in-depth at multiple
layers, the MCP tier model **fails closed** (unmapped tools → `destructive` →
denied), SQLite uses bound parameters throughout, and the backup explorer gates
every route behind session + CSRF + same-origin checks with a correct TOTP/HMAC
implementation.

The audit surfaced a small number of hardening gaps and trust-model edges. All of
the findings below have been addressed.

## Findings & remediations

### H1 — `fleet_secrets_get` returned plaintext secrets at `read` tier (allowed by default) — FIXED

Over the privilege-separated daemon, the default policy allows the entire `read`
tier with no rate limit. `fleet_secrets_get` (which returns a **decrypted** secret
value) was classified `read`, so any `fleet-guard` member — including a compromised
or prompt-injected AI session — could exfiltrate every secret with no per-tool
opt-in and no throttle. Tool **results** are intentionally not audited, so the
exfiltration would be low-visibility.

**Fix:** introduced a dedicated `secret` tier (`mcp/tiers.ts`) that is
**deny-by-default and rate-limited** (`10/min`), mirroring the `destructive`
opt-in pattern. `fleet_secrets_get` now maps to `secret`; masked/metadata tools
(`fleet_secrets_list/status/drift/validate`) stay on `read`. The operator opts in
via `mcp-policy.json` (`tiers.secret = "allow"` or per-tool).
Files: `mcp/tiers.ts`, `mcp/guard.ts`, `mcp/secrets-tools.ts`, `commands/mcp.ts`.
Tests: `mcp/tiers.test.ts`, `mcp/guard.test.ts`.

### H2 — Self-update executed code from `origin` with no integrity verification — FIXED (opt-in)

`applyUpdate()` did `git pull --ff-only` then `npm run build` (run under sudo) with
no signature/checksum verification, so a compromised upstream, stolen push token,
or un-pinned-TLS MITM was an RCE primitive (the pulled tree defines the `build`
script that runs immediately).

**Fix:** added opt-in, fail-closed signature verification. With
`FLEET_UPDATE_VERIFY=1`, the freshly pulled HEAD must pass `git verify-commit`
(optionally scoped to an SSH allowed-signers file via
`FLEET_UPDATE_ALLOWED_SIGNERS`) **before** `npm run build`; on failure the working
tree is hard-reset to the pre-pull commit and the build never runs. Default
behaviour is unchanged (most installs have no maintainer key imported, so forcing
it unconditionally would brick self-update); enabling it is strongly recommended.
Files: `core/self-update.ts`. Tests: `core/self-update.test.ts`.

### M1 — BlueBubbles password sent un-encoded in a URL query string — FIXED

The shared secret was string-concatenated into the request URL, so it landed in
access logs and could be corrupted/leaked by `&`/`#`/space characters.

**Fix:** extracted `buildBlueBubblesUrl()` which `encodeURIComponent`s the
password. Files: `core/notify.ts`. Tests: `core/notify.test.ts`.

### M2 — Backup TOTP login had no rate limiting / lockout — FIXED

`/api/login` verified a 6-digit code (±1 step window) and issued a session with no
attempt throttling, enabling online brute force through the public `/backups` path.

**Fix:** added a refilling token-bucket `LoginThrottle` (default 5 attempts/min)
consulted **before** verification; exhaustion returns `429`. A successful login is
refunded so a legitimate operator is never locked out by their own sign-ins.
Files: `core/backup/login-throttle.ts`, `core/backup/browser-api.ts`,
`core/backup/browser-server.ts`. Tests: `core/backup/login-throttle.test.ts`,
`core/backup/browser-api.test.ts`.

### M3 — `dump.ts` interpolated hook fields into shell strings without quoting — FIXED

`hook.container`, `hook.user`, `hook.port`, `userEnv`, and `passwordEnv` were
interpolated raw into `bash -c` dump commands (unlike the password/db fields, which
were quoted) — a shell-injection surface if backup-hook config is attacker-
influenced.

**Fix:** `container`/`user` now pass through `shToken()` (safe barewords emitted
as-is, anything with shell metacharacters single-quoted); env-var names are
validated as shell identifiers; the redis `port` is asserted to be an integer.
Files: `core/backup/dump.ts`. Tests: `core/backup/dump.test.ts`.

### M4 — Webhook/Telegram error logs could leak credential-bearing URLs — FIXED

The webhook logged its full URL (possible `user:pass@`/`?token=`) on every error,
and the notify path could log a tokenised API URL via a stringified error.

**Fix:** added `redactUrl()` (strips userinfo + query) used in webhook error logs,
and `scrubSecrets()` which removes adapter secrets (raw and percent-encoded) from
notify error strings before logging. Files: `adapters/notifier/webhook.ts`,
`core/notify.ts`. Tests: `adapters/notifier/webhook.test.ts`, `core/notify.test.ts`.

### M5 — `createDepsPr` built a git branch from `app.name` without re-validation; registry versions written unchecked — FIXED

The branch `deps/${app.name}/${date}` reached `git checkout -b`/`git push` without
`assertBranch` (option-injection edge), and registry-supplied `package`/version
strings were written into manifests, commits and PR bodies unchecked
(content-injection from a hostile/MITM'd registry).

**Fix:** `assertBranch()` is now called before any git op, and
`generateVersionBump()` rejects package/version strings that aren't benign tokens.
Files: `core/deps/actors/pr-creator.ts`. Tests: `core/deps/actors/pr-creator.test.ts`.

### L3 — Vault writes relied on umask for permissions — FIXED

`saveManifest` and the sealed `.age` writes had no explicit mode.

**Fix:** these writes are now created `0600` (defence in depth; contents are
already encrypted/non-secret metadata). Files: `core/secrets.ts`.

## Notes / accepted (not code-changed)

- **L1 — notify/webhook SSRF + TLS:** destinations are operator-authored config,
  not remote-attacker input. No host/scheme allowlist is enforced; redaction (M4)
  reduces leak impact. Enforcing `https://` could break intentional LAN `http://`
  use, so it is left to operator policy.
- **L2 — self-update downgrade-by-denial:** a blocked fetch reports "no update".
  Inherent to fetch-based checks; low impact.

## Confirmed-safe (reviewed, no change needed)

- `core/exec.ts` — arg-array `spawnSync`, no shell, throughout.
- MCP socket (`root:fleet-guard 0660`) and the v2 per-app secrets agent socket
  (per-app, group-scoped `0660`, key via systemd `LoadCredential`) — capability-by-
  socket trust model, by design.
- Backup explorer path handling — `..`-rejecting validator, snapshot-id regex, app
  allowlist; restic/age/docker via arg arrays.
- nginx/systemd templating — interpolated values constrained by `validate.ts` at
  both template and install layers; no directive/path-traversal injection.
- TOTP/session crypto — HMAC, `timingSafeEqual`, ±1 window, format-checked,
  20-byte random secret.
