import { describe, it, expect } from 'vitest';

import { handle, ApiContext, ApiRequest } from './browser-api';
import { totpCode, signSession } from './totp';

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

function authReq(over: Partial<ApiRequest> = {}): ApiRequest {
  const cookie = signSession({ exp: NOW + 3600_000 }, 'test-session-secret');
  return req({ cookies: { fleet_backup_session: cookie }, ...over });
}

describe('browser-api read endpoints', () => {
  it('GET /api/apps returns the status report', () => {
    const res = handle(authReq({ path: '/api/apps' }), ctx());
    expect(res.status).toBe(200);
    if (res.kind !== 'json') throw new Error('expected json');
    expect(res.body).toHaveProperty('apps');
  });

  it('GET /api/snapshots requires a known app', () => {
    expect(handle(authReq({ path: '/api/snapshots', query: { app: 'nope' } }), ctx()).status).toBe(404);
    expect(handle(authReq({ path: '/api/snapshots', query: { app: 'demo' } }), ctx()).status).toBe(200);
  });

  it('GET /api/ls rejects a path with ..', () => {
    const res = handle(authReq({ path: '/api/ls', query: { app: 'demo', snap: 'abc12345', path: '/a/../b' } }), ctx());
    expect(res.status).toBe(400);
  });

  it('GET /api/ls rejects a bad snapshot id', () => {
    const res = handle(authReq({ path: '/api/ls', query: { app: 'demo', snap: 'XXX', path: '/' } }), ctx());
    expect(res.status).toBe(400);
  });

  it('GET /api/ls returns entries with a sensitive flag', () => {
    const c = ctx({ lsTree: () => [{ name: 'id_rsa', type: 'file', path: '/root/.ssh/id_rsa', size: 1, mtime: '' }] });
    const res = handle(authReq({ path: '/api/ls', query: { app: 'demo', snap: 'abc12345', path: '/root/.ssh' } }), c);
    expect(res.status).toBe(200);
    if (res.kind !== 'json') throw new Error('expected json');
    expect((res.body as { entries: { sensitive: boolean }[] }).entries[0].sensitive).toBe(true);
  });

  it('GET /api/file refuses a sensitive path with 403', () => {
    const c = ctx({ fileMeta: () => ({ size: 10, sensitive: true }) });
    const res = handle(authReq({ path: '/api/file', query: { app: 'demo', snap: 'abc12345', path: '/root/.ssh/id_rsa' } }), c);
    expect(res.status).toBe(403);
  });

  it('GET /api/file returns a stream descriptor for a normal file', () => {
    const res = handle(authReq({ path: '/api/file', query: { app: 'demo', snap: 'abc12345', path: '/home/app/index.ts' } }), ctx());
    expect(res.kind).toBe('stream');
    expect(res.status).toBe(200);
  });

  it('GET /api/file with dl=1 forces an attachment disposition', () => {
    const res = handle(authReq({ path: '/api/file', query: { app: 'demo', snap: 'abc12345', path: '/home/app/index.ts', dl: '1' } }), ctx());
    if (res.kind !== 'stream') throw new Error('expected stream');
    expect(res.disposition).toBe('attachment');
  });

  it('GET /api/staging lists staging dirs', () => {
    const c = ctx({ listStaging: () => [{ path: '/var/restore/demo-x', bytes: 100, age: '1h' }] });
    const res = handle(authReq({ path: '/api/staging' }), c);
    expect(res.status).toBe(200);
    if (res.kind !== 'json') throw new Error('expected json');
    expect((res.body as { staging: unknown[] }).staging).toHaveLength(1);
  });

  it('maps an unreachable backend to 503', () => {
    const c = ctx({ lsTree: () => { throw new Error('Fatal: unable to open repository: connection refused'); } });
    const res = handle(authReq({ path: '/api/ls', query: { app: 'demo', snap: 'abc12345', path: '/' } }), c);
    expect(res.status).toBe(503);
  });
});
