import { appendFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';

import { type Tier, tierOf, isUnmapped } from './tiers';

export const POLICY_PATH = '/etc/fleet/mcp-policy.json';
export const AUDIT_PATH = '/var/log/fleet-mcp/audit.log';

export type TierRule = 'allow' | 'deny';

export interface Policy {
  // default decision per tier. destructive is deny out of the box.
  tiers: Record<Tier, TierRule>;
  // per-tool overrides; take precedence over the tier default.
  tools: Record<string, TierRule>;
  // calls allowed per 60s window per tier; 0 means unlimited.
  rateLimits: Record<Tier, number>;
}

export const DEFAULT_POLICY: Policy = {
  tiers: { read: 'allow', mutate: 'allow', destructive: 'deny' },
  tools: {},
  rateLimits: { read: 0, mutate: 60, destructive: 10 },
};

export type Outcome = 'allow' | 'deny' | 'rate-limited' | 'error';

export interface AuditEntry {
  ts: string;
  tool: string;
  tier: Tier;
  outcome: Outcome;
  reason?: string;
  durationMs?: number;
  error?: string;
  args?: Record<string, unknown>;
  unmapped?: boolean;
}

// merge a parsed policy file onto the defaults so a partial file is valid.
export function loadPolicy(path = POLICY_PATH): Policy {
  if (!existsSync(path)) return DEFAULT_POLICY;
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8')) as Partial<Policy>;
    return {
      tiers: { ...DEFAULT_POLICY.tiers, ...(raw.tiers ?? {}) },
      tools: { ...(raw.tools ?? {}) },
      rateLimits: { ...DEFAULT_POLICY.rateLimits, ...(raw.rateLimits ?? {}) },
    };
  } catch {
    // a corrupt policy must fail closed to the safe defaults, never open.
    return DEFAULT_POLICY;
  }
}

// strip secret values from tool arguments before they reach the audit log.
// secret NAMES (app, key) stay visible because they are useful and not sensitive;
// only the value-bearing fields are dropped. tool RESULTS are never logged.
const SENSITIVE_ARG = /^(value|secret|password|passwd|token|api_?key)$/i;

export function redactArgs(args: unknown): Record<string, unknown> | undefined {
  if (!args || typeof args !== 'object') return undefined;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(args as Record<string, unknown>)) {
    if (SENSITIVE_ARG.test(k)) {
      out[k] = '[redacted]';
    } else if (typeof v === 'string') {
      out[k] = v.length > 200 ? v.slice(0, 200) + '…' : v;
    } else if (v === null || ['number', 'boolean'].includes(typeof v)) {
      out[k] = v;
    } else {
      // arrays/objects: record the shape, not the contents, to avoid leaking
      // a secret nested somewhere unexpected.
      out[k] = Array.isArray(v) ? `[array:${v.length}]` : '[object]';
    }
  }
  return out;
}

// per-tier token bucket. capacity == the per-minute limit, refilled linearly.
class RateLimiter {
  private tokens: Record<Tier, number>;
  private last: Record<Tier, number>;

  constructor(private readonly limits: Record<Tier, number>, private readonly now: () => number) {
    this.tokens = { read: limits.read, mutate: limits.mutate, destructive: limits.destructive };
    this.last = { read: now(), mutate: now(), destructive: now() };
  }

  // try to consume one token for a tier. returns false when the bucket is empty.
  take(tier: Tier): boolean {
    const limit = this.limits[tier];
    if (limit <= 0) return true; // unlimited
    const t = this.now();
    const elapsed = (t - this.last[tier]) / 60_000;
    this.tokens[tier] = Math.min(limit, this.tokens[tier] + elapsed * limit);
    this.last[tier] = t;
    if (this.tokens[tier] >= 1) {
      this.tokens[tier] -= 1;
      return true;
    }
    return false;
  }
}

export interface GuardOptions {
  policy?: Policy;
  now?: () => number;
  // audit sink — defaults to appending json lines to AUDIT_PATH. tests inject
  // an in-memory sink to assert on what is written (and what is not).
  auditSink?: (entry: AuditEntry) => void;
}

export interface Decision {
  ok: boolean;
  tier: Tier;
  reason?: string;
}

// the guard ties together policy, rate limiting and audit. one guard is shared
// across all connections in a daemon so rate limits are global, not per-session.
export class Guard {
  private readonly policy: Policy;
  private readonly now: () => number;
  private readonly limiter: RateLimiter;
  private readonly sink: (entry: AuditEntry) => void;

  constructor(opts: GuardOptions = {}) {
    this.policy = opts.policy ?? loadPolicy();
    this.now = opts.now ?? Date.now;
    this.limiter = new RateLimiter(this.policy.rateLimits, this.now);
    this.sink = opts.auditSink ?? defaultAuditSink;
  }

  private ruleFor(tool: string, tier: Tier): TierRule {
    return this.policy.tools[tool] ?? this.policy.tiers[tier];
  }

  // decide whether a call may proceed. denials and rate-limit rejections are
  // audited here (they never execute); allowed calls are audited by complete().
  authorize(tool: string, args: unknown): Decision {
    const tier = tierOf(tool);
    const unmapped = isUnmapped(tool);
    const base = { tool, tier, args: redactArgs(args), unmapped };

    if (this.ruleFor(tool, tier) !== 'allow') {
      const reason = `tier '${tier}' denied by policy`;
      this.write({ ...base, outcome: 'deny', reason });
      return { ok: false, tier, reason };
    }
    if (!this.limiter.take(tier)) {
      const reason = `rate limit for tier '${tier}' exceeded`;
      this.write({ ...base, outcome: 'rate-limited', reason });
      return { ok: false, tier, reason };
    }
    return { ok: true, tier };
  }

  // audit the result of a call that authorize() permitted.
  complete(tool: string, args: unknown, res: { durationMs: number; error?: string }): void {
    const tier = tierOf(tool);
    this.write({
      tool,
      tier,
      args: redactArgs(args),
      outcome: res.error ? 'error' : 'allow',
      error: res.error,
      durationMs: res.durationMs,
      unmapped: isUnmapped(tool),
    });
  }

  private write(partial: Omit<AuditEntry, 'ts'>): void {
    this.sink({ ts: new Date(this.now()).toISOString(), ...partial });
  }
}

// append one json line to the audit log, creating the directory if needed.
function defaultAuditSink(entry: AuditEntry): void {
  try {
    mkdirSync(dirname(AUDIT_PATH), { recursive: true, mode: 0o750 });
    appendFileSync(AUDIT_PATH, JSON.stringify(entry) + '\n', { mode: 0o640 });
  } catch {
    // auditing must never crash the daemon; a write failure is swallowed.
  }
}
