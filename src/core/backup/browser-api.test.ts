import { describe, it, expect } from 'vitest';

import { handle, ApiContext, ApiRequest } from './browser-api';
import { totpCode } from './totp';

const NOW = 1_700_000_000_000;

function ctx(over: Partial<ApiContext> = {}): ApiContext {
  return {
    now: () => NOW,
    totpSecret: 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ',
    sessionSecret: 'test-session-secret',
    sessionTtlMs: 12 * 3600_000,
    listApps: () => ['demo'],
    statusReport: () => ({ generatedAt: 'now', backend: 'rest', appendOnly: true, apps: [] }),
    snapshots: () => [{ id: 'abc12345', shortId: 'abc12345', time: 't', hostname: 'h', paths: [], tags: [] }],
    lsTree: () => [{ name: 'f', type: 'file', path: '/f', size: 1, mtime: '' }],
    fileMeta: () => ({ size: 10, sensitive: false }),
    restore: () => ({ target: '/var/restore/demo-x', fileCount: 1, bytes: 10, durationMs: 5 }),
    listStaging: () => [],
    deleteStaging: () => {},
    ...over,
  };
}

function req(over: Partial<ApiRequest> = {}): ApiRequest {
  return {
    method: 'GET',
    path: '/api/apps',
    query: {},
    headers: { 'x-fleet-backup': '1', origin: 'https://fleet.hesketh.pro' },
    cookies: {},
    ...over,
  };
}

describe('browser-api auth', () => {
  it('serves the login page without a session', () => {
    const res = handle(req({ path: '/login', headers: {} }), ctx());
    expect(res.kind).toBe('html');
    expect(res.status).toBe(200);
  });

  it('rejects /api without a session cookie', () => {
    const res = handle(req(), ctx());
    expect(res.status).toBe(401);
  });

  it('POST /api/login with a valid totp sets a session cookie', () => {
    const code = totpCode('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ', NOW);
    const res = handle(req({
      method: 'POST', path: '/api/login', body: { code },
    }), ctx());
    expect(res.status).toBe(200);
    if (res.kind !== 'json') throw new Error('expected json');
    expect(res.setCookie).toMatch(/^fleet_backup_session=/);
  });

  it('POST /api/login with a wrong totp returns 401', () => {
    const res = handle(req({ method: 'POST', path: '/api/login', body: { code: '000000' } }), ctx());
    expect(res.status).toBe(401);
  });

  it('rejects /api requests missing the CSRF header', () => {
    const res = handle(req({ headers: { origin: 'https://fleet.hesketh.pro' } }), ctx());
    expect(res.status).toBe(403);
  });

  it('rejects /api requests with a cross-site Origin', () => {
    const res = handle(req({ headers: { 'x-fleet-backup': '1', origin: 'https://evil.example' } }), ctx());
    expect(res.status).toBe(403);
  });
});
