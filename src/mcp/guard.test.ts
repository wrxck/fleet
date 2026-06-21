import { describe, it, expect } from 'vitest';

import { Guard, DEFAULT_POLICY, loadPolicy, redactArgs, type AuditEntry, type Policy } from './guard';

// guard wired to an in-memory audit sink and a controllable clock.
function makeGuard(overrides: Partial<Policy> = {}) {
  const log: AuditEntry[] = [];
  let clock = 1_000_000;
  const policy: Policy = {
    tiers: { ...DEFAULT_POLICY.tiers, ...(overrides.tiers ?? {}) },
    tools: { ...(overrides.tools ?? {}) },
    rateLimits: { ...DEFAULT_POLICY.rateLimits, ...(overrides.rateLimits ?? {}) },
  };
  const guard = new Guard({ policy, now: () => clock, auditSink: (e) => log.push(e) });
  return { guard, log, advance: (ms: number) => { clock += ms; } };
}

describe('Guard authorisation by tier', () => {
  it('allows read and mutate, denies destructive by default', () => {
    const { guard } = makeGuard();
    expect(guard.authorize('fleet_status', {}).ok).toBeTruthy();
    expect(guard.authorize('fleet_secrets_set', { app: 'a', key: 'K', value: 'v' }).ok).toBeTruthy();
    expect(guard.authorize('fleet_deploy', { app: 'a' }).ok).toBeFalsy();
  });

  it('denies decrypted-secret reads (fleet_secrets_get) by default', () => {
    const { guard, log } = makeGuard();
    const d = guard.authorize('fleet_secrets_get', { app: 'a', key: 'DATABASE_URL' });
    expect(d.ok).toBeFalsy();
    expect(d.tier).toBe('secret');
    expect(log.at(-1)?.outcome).toBe('deny');
    // sibling read-tier secret tools (masked/metadata) stay allowed
    expect(guard.authorize('fleet_secrets_list', { app: 'a' }).ok).toBeTruthy();
    expect(guard.authorize('fleet_secrets_drift', { app: 'a' }).ok).toBeTruthy();
  });

  it('allows fleet_secrets_get only when the operator opts the secret tier (or tool) in', () => {
    const byTier = makeGuard({ tiers: { secret: 'allow' } });
    expect(byTier.guard.authorize('fleet_secrets_get', { app: 'a', key: 'K' }).ok).toBeTruthy();
    const byTool = makeGuard({ tools: { fleet_secrets_get: 'allow' } });
    expect(byTool.guard.authorize('fleet_secrets_get', { app: 'a', key: 'K' }).ok).toBeTruthy();
  });

  it('rate-limits decrypted-secret reads even once allowed (default budget 10/min)', () => {
    const { guard } = makeGuard({ tiers: { secret: 'allow' } });
    for (let i = 0; i < 10; i++) {
      expect(guard.authorize('fleet_secrets_get', { app: 'a', key: 'K' }).ok).toBeTruthy();
    }
    const limited = guard.authorize('fleet_secrets_get', { app: 'a', key: 'K' });
    expect(limited.ok).toBeFalsy();
    expect(limited.reason).toMatch(/rate limit/);
  });

  it('allows a destructive tool only when the policy opts it in', () => {
    const { guard } = makeGuard({ tools: { fleet_deploy: 'allow' } });
    expect(guard.authorize('fleet_deploy', { app: 'a' }).ok).toBeTruthy();
    // sibling destructive tools stay denied
    expect(guard.authorize('fleet_stop', { app: 'a' }).ok).toBeFalsy();
  });

  it('treats an unmapped tool as destructive and audits it as unmapped', () => {
    const { guard, log } = makeGuard();
    const d = guard.authorize('fleet_brand_new_tool', {});
    expect(d.ok).toBeFalsy();
    expect(log.at(-1)?.unmapped).toBeTruthy();
    expect(log.at(-1)?.tier).toBe('destructive');
  });

  it('records exactly one deny entry and does not consume a token', () => {
    const { guard, log } = makeGuard();
    guard.authorize('fleet_deploy', { app: 'a' });
    expect(log).toHaveLength(1);
    expect(log[0].outcome).toBe('deny');
  });
});

describe('Guard rate limiting', () => {
  it('limits a tier to its budget then refills over time', () => {
    const { guard, advance } = makeGuard({ rateLimits: { read: 0, secret: 0, mutate: 2, destructive: 0 } });
    expect(guard.authorize('fleet_secrets_set', {}).ok).toBeTruthy();
    expect(guard.authorize('fleet_secrets_set', {}).ok).toBeTruthy();
    const limited = guard.authorize('fleet_secrets_set', {});
    expect(limited.ok).toBeFalsy();
    expect(limited.reason).toMatch(/rate limit/);
    advance(60_000); // a full window refills the bucket
    expect(guard.authorize('fleet_secrets_set', {}).ok).toBeTruthy();
  });

  it('never limits an unlimited (0) tier', () => {
    const { guard } = makeGuard({ rateLimits: { read: 0, secret: 10, mutate: 60, destructive: 10 } });
    for (let i = 0; i < 50; i++) expect(guard.authorize('fleet_status', {}).ok).toBeTruthy();
  });
});

describe('Guard audit redaction', () => {
  it('redacts secret values but keeps names, and never logs the raw value', () => {
    const { guard, log } = makeGuard();
    guard.complete('fleet_secrets_set', { app: 'nutrition', key: 'API_KEY', value: 'super-secret-token' }, { durationMs: 3 });
    const entry = log.at(-1)!;
    expect(entry.args).toMatchObject({ app: 'nutrition', key: 'API_KEY', value: '[redacted]' });
    expect(JSON.stringify(entry)).not.toContain('super-secret-token');
  });

  it('redactArgs masks common secret field names and summarises nested data', () => {
    const out = redactArgs({ token: 'abc', password: 'p', nested: { a: 1 }, list: [1, 2, 3], ok: true });
    expect(out).toMatchObject({ token: '[redacted]', password: '[redacted]', nested: '[object]', list: '[array:3]', ok: true });
  });

  it('logs one allow entry on complete with timing', () => {
    const { guard, log } = makeGuard();
    guard.complete('fleet_status', {}, { durationMs: 12 });
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ outcome: 'allow', tier: 'read', durationMs: 12 });
  });
});

describe('loadPolicy', () => {
  it('falls back to safe defaults when the file is missing', () => {
    expect(loadPolicy('/nonexistent/mcp-policy.json')).toEqual(DEFAULT_POLICY);
  });
});
