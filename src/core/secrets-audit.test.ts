import { mkdtempSync, readFileSync, statSync, existsSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { describe, it, expect, beforeAll, beforeEach } from 'vitest';

import { auditLog, getAuditPath } from './secrets-audit';

describe('secrets-audit', () => {
  beforeAll(() => {
    // redirect the root-owned default (/var/log/fleet) to a writable temp dir.
    process.env.FLEET_AUDIT_DIR = mkdtempSync(join(homedir(), '.fleet-audit-test-'));
  });

  beforeEach(() => {
    if (existsSync(getAuditPath())) rmSync(getAuditPath(), { force: true });
  });

  it('creates the audit log with mode 0600', () => {
    auditLog({ op: 'rotate', app: 'poolside', secret: 'STRIPE_SECRET_KEY', ok: true });
    expect(existsSync(getAuditPath())).toBe(true);
    expect(statSync(getAuditPath()).mode & 0o777).toBe(0o600);
  });

  it('appends one JSON line per call', () => {
    auditLog({ op: 'rotate', app: 'poolside', ok: true });
    auditLog({ op: 'rollback', app: 'poolside', ok: true });
    const lines = readFileSync(getAuditPath(), 'utf-8').trim().split('\n');
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]).op).toBe('rotate');
    expect(JSON.parse(lines[1]).op).toBe('rollback');
  });

  it('records timestamp + actor', () => {
    auditLog({ op: 'set', app: 'x', secret: 'K', ok: true });
    const entry = JSON.parse(readFileSync(getAuditPath(), 'utf-8').trim());
    expect(entry.ts).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(entry.actor).toBeTruthy();
  });

  it('respects an explicit actor override', () => {
    auditLog({ op: 'set', app: 'x', actor: 'cron', ok: true });
    const entry = JSON.parse(readFileSync(getAuditPath(), 'utf-8').trim());
    expect(entry.actor).toBe('cron');
  });

  it('records a trusted numeric uid alongside the spoofable actor', () => {
    auditLog({ op: 'get', app: 'x', secret: 'K', actor: 'spoofed', ok: true });
    const entry = JSON.parse(readFileSync(getAuditPath(), 'utf-8').trim());
    // actor is environment-derived (here overridden); uid is the real one.
    expect(entry.actor).toBe('spoofed');
    expect(typeof entry.uid).toBe('number');
  });

  it('never writes a `value` field', () => {
    auditLog({ op: 'set', app: 'x', secret: 'K', ok: true, details: 'metadata only' });
    expect(readFileSync(getAuditPath(), 'utf-8')).not.toMatch(/"value"/);
  });

  it('survives sequential writes', () => {
    for (let i = 0; i < 10; i++) auditLog({ op: 'rotate', app: `app${i}`, ok: true });
    expect(readFileSync(getAuditPath(), 'utf-8').trim().split('\n')).toHaveLength(10);
  });
});
