# Spec A — Daemon security & safe agent deploy

- Status: approved (design), pending implementation plan
- Target release: v1.13.0
- Date: 2026-05-31
- Related: v1.12.0 (#117 privilege-separated daemon, #118 unprivileged-agent fixes)

## Context

v1.12.0 shipped the privilege-separated MCP root daemon and documented enabling
`fleet_deploy` for an unprivileged agent via a per-tool `allow` in
`/etc/fleet/mcp-policy.json`. Two gaps remain:

1. **Blunt allow.** A per-tool `"fleet_deploy": "allow"` lets the agent deploy/
   restart/stop *any* registered app. For an LLM agent that is a large blast
   radius — a prompt-injection could deploy or restart anything.
2. **Audit accuracy + secret leakage.** The guard's `complete()` only records an
   error when a handler *throws*. Fleet's MCP tools return `fail()` (with
   `isError: true`) instead of throwing, so a failed deploy is currently logged
   in `/var/log/fleet-mcp/audit.log` as `outcome: "allow"` with no error — the
   audit trail misreports failures as successes. Separately, the throw-path logs
   `err.message` verbatim, and tool errors can now include docker build stderr,
   which may contain secrets that then persist in the (fleet-guard-readable)
   audit log.

This spec closes both. It deliberately does **not** add out-of-band approval or
a dry-run/confirm flag: both are weak against prompt injection (a compromised
agent simply sets `confirm: true` or re-calls to execute), so they would add
friction without bounding the blast radius. The control that an agent cannot
satisfy itself — a per-app allowlist — is the one we implement.

## Goals

- Let an operator scope destructive tools to specific apps, per tool.
- Make the audit log accurately reflect tool failures.
- Stop secrets (e.g. from build stderr) persisting in the audit log, while
  keeping full detail available live to the (already-privileged) caller.
- Full backward compatibility with existing `mcp-policy.json` files.

## Non-goals (YAGNI / future specs)

- Out-of-band human approval for destructive calls.
- Dry-run / confirm-to-execute gating.
- Transport/protocol hardening, audit-log rotation (separate work).

## Design

### Component 1 — per-app allowlist for destructive tools

Extend the policy `tools` map to accept an object form alongside the existing
string rule:

```jsonc
"tools": {
  "fleet_deploy":  { "apps": ["nutrition"] },  // allowed only for these apps
  "fleet_restart": "allow",                      // any app (unchanged)
  "fleet_stop":    "deny"                         // never (unchanged)
}
```

Types (in `src/mcp/guard.ts`):

```ts
type TierRule = 'allow' | 'deny';
type ToolRule = TierRule | { apps: string[] };
interface Policy {
  tiers: Record<Tier, TierRule>;
  tools: Record<string, ToolRule>;
  rateLimits: Record<Tier, number>;
}
```

`Guard.authorize(tool, args)` already receives `args`. New resolution order:

1. Determine `rule = policy.tools[tool] ?? policy.tiers[tierOf(tool)]`.
2. If `rule === 'deny'` → deny.
3. If `rule === 'allow'` → allow (subject to rate limit). Unchanged.
4. If `rule` is `{ apps }` → read the call's `args.app`:
   - allow iff `typeof args.app === 'string'` and `args.app ∈ rule.apps`;
   - otherwise **deny** with reason
     `app '<x>' not in allowlist for <tool>` (fail-closed: a missing or
     non-string `app` arg is denied, never allowed).

Rate limiting and the tier classification are unchanged; the object form is just
a more specific opt-in than the string `allow`.

Notes:
- The object form is meaningful only for app-scoped tools (deploy, start, stop,
  restart, rollback, freeze, unfreeze — all take `app`). For a tool with no
  `app` arg, the object form fails closed (denied), which is acceptable: it is a
  misconfiguration, and denying is the safe outcome.
- `{ apps: [] }` denies everything (explicit empty allowlist).

### Component 2 — audit accuracy + secret scrubbing

`src/mcp/guarded-server.ts` `wrapHandler`:
- After `original(...)` returns, inspect the result: if it is an object with
  `isError === true`, treat the call as failed. Extract a message from the
  result's `content[].text` (joined/first), pass it to `complete()` as the
  error so the audit `outcome` is `error`, not `allow`.
- The throw path keeps recording `err.message`.

`src/mcp/guard.ts`:
- `complete()` continues to set `outcome: error ? 'error' : 'allow'`.
- Before writing any error/reason string to the audit sink, pass it through a
  new `scrubForAudit()` (see Component 3).

This makes failed tool calls show up correctly in the audit log **and** ensures
whatever error text is persisted is scrubbed.

The **live caller response is untouched** — `server.ts` `fail()` still returns
the full stderr to the caller (an authorized `fleet-guard` member who needs it
to debug). Only the persisted audit log is scrubbed.

### Component 3 — `scrubForAudit`

New pure function (own module `src/mcp/redact.ts`, or alongside `guard.ts`):

```ts
function scrubForAudit(text: string): string
```

- Take the first non-empty line (build/systemctl errors put the cause first;
  the rest is noise for an audit trail).
- Redact, in order:
  - `AGE-SECRET-KEY-1[0-9A-Z]+` → `[redacted-age-key]`
  - long high-entropy hex/base64 runs (≥ 32 chars) → `[redacted]`
  - `KEY=value` / `KEY: value` where the value is long/high-entropy → redact the
    value, keep the key
- Cap the result at ~300 chars (append `…` when truncated).

Scrubbing free text is best-effort, not a guarantee; combined with "first line
only + hard cap" it makes secret persistence unlikely while keeping the audit
entry useful. The existing `redactArgs` (argument redaction) is unchanged.

### Backward compatibility

- `loadPolicy` parses string **or** `{apps:string[]}` per tool. Unknown/extra
  shapes for a tool fall back to the tier default (fail-closed for destructive).
- Existing policies (`"allow"`, `"deny"`, empty `tools`) behave exactly as
  before.
- A corrupt policy file still loads `DEFAULT_POLICY` (destructive denied).

## Testing

- `guard.test.ts`
  - `{apps:[…]}`: allowed for a listed app, denied for an unlisted app, denied
    when `app` arg is missing/non-string, `{apps:[]}` denies all.
  - string `"allow"`/`"deny"` still behave as before (backward compat).
  - a result with `isError:true` is audited as `outcome:"error"`.
- `redact.test.ts`
  - age key, high-entropy token, `KEY=value` redaction; first-line extraction;
    length cap.
- `guarded-server.test.ts`
  - end-to-end: a destructive call that returns `isError` produces a scrubbed,
    `error`-classified audit entry; an allowed call is unaffected.

## Docs

- README "Running fleet from an unprivileged Claude session": show the
  `{apps:[…]}` form as the recommended way to enable agent deploy.
- `data/mcp-policy.example.json`: switch the example to per-app scoping
  (e.g. `"fleet_deploy": { "apps": ["nutrition"] }`) with a comment explaining
  it bounds the blast radius.

## Rollout

- No migration needed; new policy syntax is opt-in.
- Ships in v1.13.0 alongside Spec B (ergonomics) and Spec C (release flow),
  each as its own spec/plan.
