import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync, statSync, existsSync, rmSync } from 'node:fs';

const { FAKE_HOME } = vi.hoisted(() => {
  const { mkdtempSync } = require('node:fs');
  const { tmpdir } = require('node:os');
  const { join } = require('node:path');
  return { FAKE_HOME: mkdtempSync(join(tmpdir(), 'fleet-audit-test-')) };
});

vi.mock('node:os', async () => {
  const actual = await vi.importActual<typeof import('node:os')>('node:os');
  return { ...actual, homedir: () => FAKE_HOME };
});

import { auditLog, getAuditPath } from './secrets-audit.js';

describe('secrets-audit', () => {
  beforeEach(() => {
    if (existsSync(getAuditPath())) rmSync(getAuditPath(), { force: true });
  });

  it('creates the audit log with mode 0600', () => {
    auditLog({ op: 'rotate', app: 'macpool', secret: 'STRIPE_SECRET_KEY', ok: true });
    expect(existsSync(getAuditPath())).toBe(true);
    expect(statSync(getAuditPath()).mode & 0o777).toBe(0o600);
  });

  it('appends one JSON line per call', () => {
    auditLog({ op: 'rotate', app: 'macpool', ok: true });
    auditLog({ op: 'rollback', app: 'macpool', ok: true });
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

  it('never writes a `value` field', () => {
    auditLog({ op: 'set', app: 'x', secret: 'K', ok: true, details: 'metadata only' });
    expect(readFileSync(getAuditPath(), 'utf-8')).not.toMatch(/"value"/);
  });

  it('survives sequential writes', () => {
    for (let i = 0; i < 10; i++) auditLog({ op: 'rotate', app: `app${i}`, ok: true });
    expect(readFileSync(getAuditPath(), 'utf-8').trim().split('\n')).toHaveLength(10);
  });
});
