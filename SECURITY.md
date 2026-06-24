# Security Policy

## Reporting a vulnerability

Please report security issues privately via **GitHub Security Advisories**
(`Security` → `Report a vulnerability` on the repository) rather than opening a
public issue. If you cannot use that channel, email the maintainer at the
address listed in `package.json`. We aim to acknowledge reports within a few
days.

## Supported versions

Security fixes target the latest published `1.x` release. Older versions are not
backported.

## Security model

fleet manages production infrastructure on a single host. It is an
**operator tool**, not a multi-tenant service: it assumes the people who can
invoke it are trusted to administer the box. Several components are therefore
*intentionally* powerful, and their safety rests on a small number of trust
boundaries documented below. Understanding these is essential to deploying
fleet safely.

### How privilege is structured

- **CLI / library code** runs as the invoking user. Operations that touch
  systemd, Docker, nginx, or the secret store require root (usually via
  `sudo`).
- **The MCP root daemon** (`fleet-mcp`) runs as root because it must drive
  `systemctl`/`docker`/`nginx`. It is intentionally *not* sandboxed. Access is
  mediated by a unix-domain socket whose filesystem ACL (`root:fleet-guard`,
  mode `0660`) is the trust boundary, plus a deny-by-default tool-tier policy.
- **The per-app secrets agent (v2)** runs as a hardened systemd `DynamicUser`
  and serves decrypted values over a per-app unix socket.
- **The Telegram / BlueBubbles bot** is the most powerful component and is
  covered in detail below.

### Command execution

All subprocess execution goes through `spawn`/`spawnSync` with **argument
arrays and no shell** (`src/core/exec.ts`). Classic shell-metacharacter
injection is therefore structurally impossible in the TypeScript surface. The
residual classes we actively guard against are *argument injection* (a value
parsed as a flag — mitigated with input validation and `--` separators) and a
small number of deliberately-escaped `sh -c` builders.

No hand-rolled cryptography is used. All key and credential generation is
delegated to `age` / `age-keygen` / `systemd-creds`, which draw from the OS
CSPRNG.

## Known by-design impacts

These are deliberate trade-offs, not defects. Each one is a place where security
depends on the operator deploying fleet as intended.

1. **The bot container is root-equivalent.** When deployed, the
   Telegram/BlueBubbles bot runs with `network_mode: host`, the Docker socket
   mounted, and the host home mounted read-write. `/sh` is *intentional*
   arbitrary host execution. Consequently **the sender allowlist is the entire
   security perimeter** — anyone who can issue commands to the bot can take over
   the host. Configure an explicit operator sender allowlist; never point the
   bot at a group chat without one. (See "Bot authorization" below.)

2. **`fleet-guard` group membership is root-equivalent.** Any process whose user
   is in the `fleet-guard` group can reach the full policy-allowed tool surface
   of the root MCP daemon. Treat adding a user to `fleet-guard` as granting root.
   The daemon socket (`/run/fleet-mcp/mcp.sock`) is created and locked to
   `root:fleet-guard 0660` by systemd via `fleet-mcp.socket` (no listen-then-chmod
   race). Authorization is by group membership; the audit log records the tool,
   tier and outcome but **not** the calling uid/pid, so a multi-member guard
   group has no per-principal attribution — keep the group to a single trusted
   operator if attribution matters.

3. **The v2 secrets socket authorizes by unix group only.** A per-app secrets
   agent serves all of that app's decrypted secrets to any process that can open
   its socket (i.e. shares the socket's gid). Security depends on that gid having
   exactly one intended member and the socket mount not being shared with other
   containers.

4. **Decrypted secret files are world-readable inside a private directory.**
   Runtime secret files under `/run/fleet-secrets/<app>/secrets/` are written
   mode `0644` so the consumer container's uid can read them; host containment
   relies on the parent directory being `0700 root:root`.

5. **Master-key rotation retains old key material.** Rotation leaves a backup of
   the previous private key (`age.key.old`) until cleanup, and historical vault
   snapshots remain encrypted under the *old* key. If an old key is recovered,
   pre-rotation snapshots become decryptable. `fleet doctor` warns if a stale
   `age.key.old` is present.

6. **The Cloudflare guard executor uses a global API key.** `fleet-guard-execute`
   authenticates to Cloudflare with a global `X-Auth-Key`, which has account-wide
   scope. Prefer a scoped API token if your threat model requires limiting blast
   radius.

7. **`passwordHostCommand` in backup config is operator-trusted RCE.** The backup
   dump hook will run an operator-specified command to obtain a database password.
   This field comes only from local backup configuration, never from network
   input, and is trusted by design.

8. **The backup restore explorer depends on its nginx front-end.** The explorer
   HTTP server binds `127.0.0.1` only and is designed to sit behind an nginx site
   that enforces IP allow-listing and HTTP Basic Auth. fleet does **not** generate
   that nginx site — it is hand-deployed. A misdeployment that exposes the
   explorer port directly drops protection to its in-process TOTP layer only.

9. **The egress allowlist trusts reverse DNS.** Hostname-form allow entries are
   matched against attacker-influenceable PTR records. Egress is observe-only in
   the current release; enforcement (when it ships) will require forward-confirmed
   reverse DNS.

10. **SSH known-hosts uses fail-closed defaults, not weakened verification.** SSH
    to remote runners uses `BatchMode=yes` with default host-key checking — unknown
    or changed host keys fail closed. There is no `StrictHostKeyChecking=no`
    anywhere. First-contact hosts must be pre-seeded in `known_hosts`.

The secrets audit log is written to a fixed root-owned directory
(`FLEET_AUDIT_DIR`, default `/var/log/fleet`) at mode `0600`, and each entry
records a trusted `uid` (the kernel login/process uid) alongside the
environment-derived `actor`, so the trail no longer fragments across user homes
and the actor cannot be silently spoofed via `SUDO_USER`.

## Bot authorization

The bot's sender authorization is the single most important control to configure
correctly:

- Provide an **explicit operator sender allowlist**. Sender authorization is
  default-deny: with no allowlist configured the bot will only accept commands
  from a private (1:1) chat with the operator and refuses to start against a
  group chat ID.
- The BlueBubbles webhook authenticates request bodies with an HMAC signature
  using a secret that is **separate** from the BlueBubbles API password, and
  rejects stale/replayed requests via a signed timestamp + nonce.
- Sensitive commands (`/sh`, `/secrets`) should be routed through `fleet-guard`
  approval where possible.
- `/claude` runs with the host home mounted and read-only file tools plus web
  fetch enabled, so an authorized operator can read host files and reach the
  network through it. This is gated entirely by the sender allowlist above; do
  not widen the allowlist beyond trusted operators.

## Dependency posture

`npm audit` runs in CI against **production** dependencies and fails on a
HIGH-or-above advisory (`npm run audit:prod`). A small `overrides` block in
`package.json` pins patched versions of transitive dependencies that fleet does
not exercise at runtime:

- `express` / `qs` / `ip-address` / `express-rate-limit` / `hono` / `fast-uri`
  are pulled in by `@modelcontextprotocol/sdk` for its HTTP/SSE transport. fleet
  uses a **custom unix-socket MCP transport** (`src/mcp/socket-transport.ts`) and
  never imports the SDK's HTTP transport, so those advisories are not on a
  reachable code path. The overrides keep the audit clean and pull the patched
  versions regardless.
- `ws` is pulled in by `ink` (the TUI renderer) and is not used as a
  network-facing server.

Dev-only advisories (e.g. Vitest UI / Vite dev-server issues that only apply when
running interactive dev tooling, often Windows-specific) are intentionally out of
scope for the CI gate.

> **Build note:** `better-sqlite3` is a native module. If you run tests under a
> Node version different from the one its prebuilt binary targets, run
> `npm rebuild better-sqlite3` once. CI installs with `npm ci`, which builds
> against the active Node version automatically.
