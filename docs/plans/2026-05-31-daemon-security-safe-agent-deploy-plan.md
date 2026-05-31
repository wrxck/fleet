# Daemon security & safe agent deploy — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let operators scope destructive MCP tools to specific apps, make the audit log accurately record tool failures, and stop secrets persisting in the audit log.

**Architecture:** Extend the daemon's policy model (`src/mcp/guard.ts`) with a per-tool `{apps:[…]}` rule the guard enforces against the call's `app` arg; detect `isError` results in `src/mcp/guarded-server.ts` so failures are audited; scrub error/reason text via a new `src/mcp/redact.ts` before it reaches the audit sink. Live caller responses are unchanged.

**Tech Stack:** TypeScript (ESM), vitest. Tests run with `npx vitest run <file>`.

**Spec:** `docs/specs/2026-05-31-daemon-security-safe-agent-deploy-design.md`

---

## File Structure

- Create: `src/mcp/redact.ts` — `scrubForAudit(text)` pure function.
- Create: `src/mcp/redact.test.ts` — tests for the scrubber.
- Modify: `src/mcp/guard.ts` — `ToolRule` type, `loadPolicy` normalisation, app-scoped `authorize`, scrub in `write`.
- Modify: `src/mcp/guard.test.ts` — policy parsing + app-scope + scrub tests.
- Modify: `src/mcp/guarded-server.ts` — record `isError` results as audit errors.
- Modify: `src/mcp/guarded-server.test.ts` — end-to-end audit-accuracy test.
- Modify: `README.md`, `data/mcp-policy.example.json` — document the per-app form.

Conventions to follow (existing repo rules enforced by hooks): comments lowercase + british spelling; no `any`; prefer `toBeTruthy()`/`toBeFalsy()` over `toBe(true)`. Commit as Matt (`-c user.name`/`user.email`), never `git add -A`, set `export SSH_AUTH_SOCK=/tmp/fleet-ssh-agent.sock` before any push.

---

## Task 1: `scrubForAudit` redactor

**Files:**
- Create: `src/mcp/redact.ts`
- Test: `src/mcp/redact.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// src/mcp/redact.test.ts
import { describe, it, expect } from 'vitest';
import { scrubForAudit } from './redact';

describe('scrubForAudit', () => {
  it('redacts an age secret key', () => {
    const out = scrubForAudit('decrypt failed for AGE-SECRET-KEY-1QQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQ now');
    expect(out).not.toMatch(/AGE-SECRET-KEY-1QQ/);
    expect(out).toContain('[redacted-age-key]');
  });

  it('redacts the value of a secret-looking KEY=value', () => {
    const out = scrubForAudit('env: DB_PASSWORD=hunter2hunter2hunter2 set');
    expect(out).toContain('DB_PASSWORD=[redacted]');
    expect(out).not.toContain('hunter2hunter2hunter2');
  });

  it('redacts a long high-entropy token', () => {
    const out = scrubForAudit('bearer deadbeefdeadbeefdeadbeefdeadbeef0123 used');
    expect(out).not.toContain('deadbeefdeadbeefdeadbeefdeadbeef0123');
    expect(out).toContain('[redacted]');
  });

  it('keeps only the first non-empty line', () => {
    const out = scrubForAudit('\n  first line here\nsecond line\nthird');
    expect(out).toBe('first line here');
  });

  it('caps length and appends an ellipsis', () => {
    const out = scrubForAudit('x'.repeat(400));
    expect(out.length).toBeLessThanOrEqual(301);
    expect(out.endsWith('…')).toBeTruthy();
  });

  it('returns empty string for empty input', () => {
    expect(scrubForAudit('')).toBe('');
  });
});
```

- [ ] **Step 2: Run the tests, verify they fail**

Run: `npx vitest run src/mcp/redact.test.ts`
Expected: FAIL — `Failed to resolve import "./redact"` / `scrubForAudit is not a function`.

- [ ] **Step 3: Implement `scrubForAudit`**

```ts
// src/mcp/redact.ts

// best-effort scrubber for free-text error/reason strings before they are
// persisted to the audit log. not a guarantee — paired with first-line + a hard
// cap so a stray secret in e.g. docker build stderr does not accumulate on disk.
// the live caller response is never scrubbed; this is audit-log only.

const AGE_KEY = /AGE-SECRET-KEY-1[0-9A-Z]+/g;
// secret-looking assignment: NAME containing key/token/secret/pass(word)/pwd = value
const SECRET_ASSIGN = /\b([A-Za-z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD|PASSWD|PWD)[A-Za-z0-9_]*)\s*[=:]\s*(\S+)/gi;
// long high-entropy run (hex / base64-ish), 32+ chars
const HIGH_ENTROPY = /[A-Za-z0-9+/_-]{32,}={0,2}/g;
const MAX_LEN = 300;

export function scrubForAudit(text: string): string {
  if (!text) return '';
  const firstLine = text.split('\n').map(l => l.trim()).find(l => l.length > 0) ?? '';
  let out = firstLine
    .replace(AGE_KEY, '[redacted-age-key]')
    .replace(SECRET_ASSIGN, (_m, key: string) => `${key}=[redacted]`)
    .replace(HIGH_ENTROPY, '[redacted]');
  if (out.length > MAX_LEN) out = out.slice(0, MAX_LEN) + '…';
  return out;
}
```

- [ ] **Step 4: Run the tests, verify they pass**

Run: `npx vitest run src/mcp/redact.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/mcp/redact.ts src/mcp/redact.test.ts
git -c user.name="Matt Hesketh" -c user.email="matt@heskethwebdesign.co.uk" \
  commit -m "feat(mcp): add scrubForAudit redactor for audit-log error text"
```

---

## Task 2: `ToolRule` type + `loadPolicy` normalisation

**Files:**
- Modify: `src/mcp/guard.ts`
- Test: `src/mcp/guard.test.ts`

- [ ] **Step 1: Write the failing tests** (append inside `src/mcp/guard.test.ts`)

```ts
import { loadPolicy } from './guard';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('loadPolicy tool rules', () => {
  function writePolicy(obj: unknown): string {
    const dir = mkdtempSync(join(tmpdir(), 'fleet-policy-'));
    const p = join(dir, 'mcp-policy.json');
    writeFileSync(p, JSON.stringify(obj));
    return p;
  }

  it('keeps a string allow/deny rule', () => {
    const p = writePolicy({ tools: { fleet_deploy: 'allow', fleet_stop: 'deny' } });
    const pol = loadPolicy(p);
    expect(pol.tools.fleet_deploy).toBe('allow');
    expect(pol.tools.fleet_stop).toBe('deny');
  });

  it('keeps an app-scoped { apps } rule', () => {
    const p = writePolicy({ tools: { fleet_deploy: { apps: ['nutrition', 'macpool'] } } });
    const pol = loadPolicy(p);
    expect(pol.tools.fleet_deploy).toEqual({ apps: ['nutrition', 'macpool'] });
  });

  it('drops a malformed tool rule (fails closed to tier default)', () => {
    const p = writePolicy({ tools: { fleet_deploy: { apps: [1, 2] }, fleet_start: 'maybe' } });
    const pol = loadPolicy(p);
    expect(pol.tools.fleet_deploy).toBeUndefined();
    expect(pol.tools.fleet_start).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the tests, verify they fail**

Run: `npx vitest run src/mcp/guard.test.ts -t "loadPolicy tool rules"`
Expected: FAIL — malformed rules are currently kept verbatim (no normalisation), and the `{apps}` assertion may fail typing.

- [ ] **Step 3: Implement the type + normalisation in `src/mcp/guard.ts`**

Change the `TierRule` block and `Policy` interface:

```ts
export type TierRule = 'allow' | 'deny';
// a per-tool rule: a flat allow/deny, or an app-scoped allow that only permits
// the tool for the listed apps (matched against the call's `app` arg).
export type ToolRule = TierRule | { apps: string[] };

export interface Policy {
  tiers: Record<Tier, TierRule>;
  // per-tool overrides; take precedence over the tier default.
  tools: Record<string, ToolRule>;
  rateLimits: Record<Tier, number>;
}
```

Add a normaliser above `loadPolicy`:

```ts
// keep only well-formed tool rules; anything else is dropped so the tool falls
// through to its tier default (fail-closed for destructive tools).
function normaliseTools(raw: unknown): Record<string, ToolRule> {
  const out: Record<string, ToolRule> = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [tool, v] of Object.entries(raw as Record<string, unknown>)) {
    if (v === 'allow' || v === 'deny') { out[tool] = v; continue; }
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      const apps = (v as { apps?: unknown }).apps;
      if (Array.isArray(apps) && apps.every((a): a is string => typeof a === 'string')) {
        out[tool] = { apps };
      }
    }
  }
  return out;
}
```

Update `loadPolicy` to use it (replace the `tools:` line):

```ts
    return {
      tiers: { ...DEFAULT_POLICY.tiers, ...(raw.tiers ?? {}) },
      tools: normaliseTools(raw.tools),
      rateLimits: { ...DEFAULT_POLICY.rateLimits, ...(raw.rateLimits ?? {}) },
    };
```

- [ ] **Step 4: Run the tests, verify they pass**

Run: `npx vitest run src/mcp/guard.test.ts -t "loadPolicy tool rules"`
Expected: PASS (3 tests). Also run the whole file to confirm no regressions: `npx vitest run src/mcp/guard.test.ts`.

- [ ] **Step 5: Commit**

```bash
git add src/mcp/guard.ts src/mcp/guard.test.ts
git -c user.name="Matt Hesketh" -c user.email="matt@heskethwebdesign.co.uk" \
  commit -m "feat(mcp): policy supports per-app { apps } tool rule"
```

---

## Task 3: app-scoped enforcement in `authorize`

**Files:**
- Modify: `src/mcp/guard.ts`
- Test: `src/mcp/guard.test.ts`

- [ ] **Step 1: Write the failing tests** (append inside `src/mcp/guard.test.ts`)

```ts
import { Guard } from './guard';

describe('Guard app-scoped authorize', () => {
  function guardWith(tools: Record<string, unknown>) {
    return new Guard({
      policy: {
        tiers: { read: 'allow', mutate: 'allow', destructive: 'deny' },
        tools: tools as never,
        rateLimits: { read: 0, mutate: 0, destructive: 0 },
      },
      auditSink: () => {},
    });
  }

  it('allows a listed app', () => {
    const g = guardWith({ fleet_deploy: { apps: ['nutrition'] } });
    expect(g.authorize('fleet_deploy', { app: 'nutrition' }).ok).toBeTruthy();
  });

  it('denies an unlisted app', () => {
    const g = guardWith({ fleet_deploy: { apps: ['nutrition'] } });
    const d = g.authorize('fleet_deploy', { app: 'other' });
    expect(d.ok).toBeFalsy();
    expect(d.reason).toMatch(/not in allowlist/);
  });

  it('denies when the app arg is missing (fail-closed)', () => {
    const g = guardWith({ fleet_deploy: { apps: ['nutrition'] } });
    expect(g.authorize('fleet_deploy', {}).ok).toBeFalsy();
  });

  it('an empty allowlist denies everything', () => {
    const g = guardWith({ fleet_deploy: { apps: [] } });
    expect(g.authorize('fleet_deploy', { app: 'nutrition' }).ok).toBeFalsy();
  });

  it('string allow still works for any app (backward compat)', () => {
    const g = guardWith({ fleet_deploy: 'allow' });
    expect(g.authorize('fleet_deploy', { app: 'anything' }).ok).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run the tests, verify they fail**

Run: `npx vitest run src/mcp/guard.test.ts -t "app-scoped authorize"`
Expected: FAIL — `ruleFor` returns the object but `authorize` compares it with `!== 'allow'` and denies as a plain tier denial, so reasons/aps are wrong.

- [ ] **Step 3: Implement app-scoped logic**

Replace `ruleFor` and the policy check at the top of `authorize` in `src/mcp/guard.ts`:

```ts
  private ruleFor(tool: string, tier: Tier): ToolRule {
    return this.policy.tools[tool] ?? this.policy.tiers[tier];
  }

  authorize(tool: string, args: unknown): Decision {
    const tier = tierOf(tool);
    const unmapped = isUnmapped(tool);
    const base = { tool, tier, args: redactArgs(args), unmapped };

    const rule = this.ruleFor(tool, tier);
    let allowed: boolean;
    let denyReason = '';
    if (rule === 'allow') {
      allowed = true;
    } else if (rule === 'deny') {
      allowed = false;
      denyReason = `tier '${tier}' denied by policy`;
    } else {
      // app-scoped rule: allow only when the call's `app` arg is listed.
      const app = (args && typeof args === 'object')
        ? (args as Record<string, unknown>).app
        : undefined;
      if (typeof app === 'string' && rule.apps.includes(app)) {
        allowed = true;
      } else {
        allowed = false;
        denyReason = typeof app === 'string'
          ? `app '${app}' not in allowlist for ${tool}`
          : `${tool} is app-scoped but no app was provided`;
      }
    }

    if (!allowed) {
      this.write({ ...base, outcome: 'deny', reason: denyReason });
      return { ok: false, tier, reason: denyReason };
    }
    if (!this.limiter.take(tier)) {
      const reason = `rate limit for tier '${tier}' exceeded`;
      this.write({ ...base, outcome: 'rate-limited', reason });
      return { ok: false, tier, reason };
    }
    return { ok: true, tier };
  }
```

- [ ] **Step 4: Run the tests, verify they pass**

Run: `npx vitest run src/mcp/guard.test.ts`
Expected: PASS (all, including the prior `loadPolicy` + existing guard tests).

- [ ] **Step 5: Commit**

```bash
git add src/mcp/guard.ts src/mcp/guard.test.ts
git -c user.name="Matt Hesketh" -c user.email="matt@heskethwebdesign.co.uk" \
  commit -m "feat(mcp): enforce per-app allowlist for destructive tools"
```

---

## Task 4: audit accuracy (isError) + scrub on write

**Files:**
- Modify: `src/mcp/guard.ts` (scrub in `write`)
- Modify: `src/mcp/guarded-server.ts` (record `isError` results)
- Test: `src/mcp/guarded-server.test.ts`

- [ ] **Step 1: Write the failing test** (append inside `src/mcp/guarded-server.test.ts`)

```ts
import { describe, it, expect } from 'vitest';
import { Guard, type AuditEntry } from './guard';
import { guarded } from './guarded-server';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

function harness(handlers: Map<string, (...a: unknown[]) => unknown>) {
  return {
    tool(name: string, ...rest: unknown[]) {
      handlers.set(name, rest[rest.length - 1] as (...a: unknown[]) => unknown);
    },
  } as unknown as McpServer;
}

describe('guarded-server audit accuracy', () => {
  it('records an isError result as outcome=error with scrubbed text', async () => {
    const entries: AuditEntry[] = [];
    const guard = new Guard({
      policy: { tiers: { read: 'allow', mutate: 'allow', destructive: 'allow' }, tools: {}, rateLimits: { read: 0, mutate: 0, destructive: 0 } },
      auditSink: (e) => entries.push(e),
    });
    const handlers = new Map<string, (...a: unknown[]) => unknown>();
    const server = guarded(harness(handlers), guard);
    // a destructive tool that fails with secret-bearing stderr (returns, not throws)
    server.tool('fleet_deploy', 'x', { app: () => {} }, async () => ({
      content: [{ type: 'text', text: 'build failed: DB_PASSWORD=hunter2hunter2hunter2hunter2' }],
      isError: true,
    }));
    await handlers.get('fleet_deploy')!({ app: 'nutrition' }, {});
    const err = entries.find(e => e.tool === 'fleet_deploy' && e.outcome === 'error');
    expect(err).toBeDefined();
    expect(err!.error).toBeDefined();
    expect(err!.error).not.toContain('hunter2hunter2hunter2');
  });

  it('records a normal result as outcome=allow', async () => {
    const entries: AuditEntry[] = [];
    const guard = new Guard({
      policy: { tiers: { read: 'allow', mutate: 'allow', destructive: 'allow' }, tools: {}, rateLimits: { read: 0, mutate: 0, destructive: 0 } },
      auditSink: (e) => entries.push(e),
    });
    const handlers = new Map<string, (...a: unknown[]) => unknown>();
    const server = guarded(harness(handlers), guard);
    server.tool('fleet_list', 'x', async () => ({ content: [{ type: 'text', text: 'ok' }] }));
    await handlers.get('fleet_list')!({});
    expect(entries.find(e => e.tool === 'fleet_list')!.outcome).toBe('allow');
  });
});
```

- [ ] **Step 2: Run the test, verify it fails**

Run: `npx vitest run src/mcp/guarded-server.test.ts -t "audit accuracy"`
Expected: FAIL — the isError result is currently recorded as `outcome: 'allow'` (no error extracted), so no `outcome === 'error'` entry exists.

- [ ] **Step 3a: Record isError results in `src/mcp/guarded-server.ts`**

Add a helper above `wrapHandler`:

```ts
// pull an error message out of a tool result that signalled failure via
// isError, so the guard can audit it as a failure (handlers return rather than
// throw, so without this a failed call is mis-recorded as a success).
function errorTextFromResult(result: unknown): string | undefined {
  if (!result || typeof result !== 'object') return undefined;
  const r = result as { isError?: unknown; content?: unknown };
  if (r.isError !== true) return undefined;
  if (!Array.isArray(r.content)) return 'tool reported an error';
  const joined = r.content
    .map(c => (c && typeof c === 'object' && typeof (c as { text?: unknown }).text === 'string')
      ? (c as { text: string }).text : '')
    .filter(Boolean)
    .join(' ');
  return joined || 'tool reported an error';
}
```

Change the success branch of `wrapHandler`:

```ts
    try {
      const result = await original(...callArgs);
      guard.complete(name, toolArgs, { durationMs: Date.now() - start, error: errorTextFromResult(result) });
      return result;
    } catch (err) {
      guard.complete(name, toolArgs, { durationMs: Date.now() - start, error: (err as Error).message });
      throw err;
    }
```

- [ ] **Step 3b: Scrub error/reason in `Guard.write` (`src/mcp/guard.ts`)**

Add the import at the top of `guard.ts`:

```ts
import { scrubForAudit } from './redact';
```

Replace the `write` method:

```ts
  private write(partial: Omit<AuditEntry, 'ts'>): void {
    // scrub free-text error/reason before persisting; args are already redacted.
    const cleaned: Omit<AuditEntry, 'ts'> = {
      ...partial,
      ...(partial.error !== undefined ? { error: scrubForAudit(partial.error) } : {}),
      ...(partial.reason !== undefined ? { reason: scrubForAudit(partial.reason) } : {}),
    };
    this.sink({ ts: new Date(this.now()).toISOString(), ...cleaned });
  }
```

- [ ] **Step 4: Run the tests, verify they pass**

Run: `npx vitest run src/mcp/guarded-server.test.ts src/mcp/guard.test.ts`
Expected: PASS (new audit-accuracy tests + all existing guard/guarded-server tests).

- [ ] **Step 5: Commit**

```bash
git add src/mcp/guard.ts src/mcp/guarded-server.ts src/mcp/guarded-server.test.ts
git -c user.name="Matt Hesketh" -c user.email="matt@heskethwebdesign.co.uk" \
  commit -m "fix(mcp): audit isError results as failures and scrub persisted error text"
```

---

## Task 5: docs + example policy

**Files:**
- Modify: `data/mcp-policy.example.json`
- Modify: `README.md`

- [ ] **Step 1: Update the example policy to per-app scoping**

Replace the `tools` block in `data/mcp-policy.example.json` so deploy is app-scoped, and update the leading `_comment` to mention it:

```json
  "_comment": "Example /etc/fleet/mcp-policy.json that lets an UNPRIVILEGED MCP client (e.g. Claude run as an ordinary user) deploy and manage SPECIFIC apps through the privilege-separated root daemon — without sudo. read/mutate stay allowed; the destructive tier stays denied by default, and deploy/lifecycle are opted in per-tool AND scoped to named apps via { apps: [...] } so a compromised agent cannot touch anything off the list. Every call is still rate-limited and written to /var/log/fleet-mcp/audit.log. Copy to /etc/fleet/mcp-policy.json and restart the daemon (sudo systemctl restart fleet-mcp).",
  "tiers": {
    "read": "allow",
    "mutate": "allow",
    "destructive": "deny"
  },
  "tools": {
    "fleet_deploy": { "apps": ["nutrition"] },
    "fleet_restart": { "apps": ["nutrition"] },
    "fleet_start": { "apps": ["nutrition"] },
    "fleet_stop": { "apps": ["nutrition"] }
  },
```

(Keep the existing `rateLimits` block unchanged.)

- [ ] **Step 2: Update the README per-tool snippet**

In `README.md`, in the "Running fleet from an unprivileged Claude session" subsection, replace the JSON policy snippet's `tools` block with the app-scoped form and add a sentence after it:

```json
  "tools": {
    "fleet_deploy": { "apps": ["nutrition"] },
    "fleet_start":  { "apps": ["nutrition"] },
    "fleet_stop":   { "apps": ["nutrition"] },
    "fleet_restart":{ "apps": ["nutrition"] }
  }
```

Add after the snippet:

> Scope each tool to named apps with `{ "apps": [...] }` so an agent can only act on apps you list — a bare `"allow"` permits every app and is a much larger blast radius. Use `"allow"` only if you genuinely want unrestricted deploys.

- [ ] **Step 3: Commit**

```bash
git add data/mcp-policy.example.json README.md
git -c user.name="Matt Hesketh" -c user.email="matt@heskethwebdesign.co.uk" \
  commit -m "docs(mcp): document per-app allowlist for unprivileged agent deploy"
```

---

## Task 6: full verification

- [ ] **Step 1: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean (no output / exit 0).

- [ ] **Step 2: Full test suite**

Run: `npx vitest run`
Expected: all pass except the known pre-existing, environment-only failures when run as root (routines/sqlite, the `daemon.test.ts` "refuses to run as a non-root user" test, and a flaky rate-limiter timing test). No NEW failures versus base.

- [ ] **Step 3: Push the branch**

```bash
export SSH_AUTH_SOCK=/tmp/fleet-ssh-agent.sock
git push -u origin docs/spec-daemon-security
```

(Then open a PR to `develop` via the normal flow — out of scope for this plan.)

---

## Self-Review

- **Spec coverage:**
  - Per-app allowlist -> Tasks 2 (parse) + 3 (enforce). [covered]
  - Audit accuracy (isError) -> Task 4 (guarded-server). [covered]
  - Secret scrubbing -> Task 1 (scrubber) + Task 4 (applied in `write`). [covered]
  - Caller response untouched -> no task modifies `server.ts` `fail()`; only `write`/audit changed. [covered]
  - Backward compat (string allow/deny, corrupt -> defaults) -> Task 2 tests. [covered]
  - Docs + example -> Task 5. [covered]
- **Placeholder scan:** none — every code step has full code.
- **Type consistency:** `ToolRule` defined in Task 2 and used by `ruleFor`/`authorize` in Task 3 and `normaliseTools` in Task 2; `scrubForAudit` defined in Task 1, imported in Task 4; `errorTextFromResult` defined and used in Task 4; `AuditEntry` is an existing export used by the Task 4 test.
