import { mkdtempSync } from 'node:fs';
import type { Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, it, expect, afterEach } from 'vitest';

import { startServer } from './browser-server';

// pin staging to a tmp dir so the suite doesn't need /var/restore (root-owned).
const STAGING = mkdtempSync(join(tmpdir(), 'fleet-explorer-test-'));

let server: Server | undefined;
afterEach(() => server?.close());

async function get(port: number, path: string, headers: Record<string, string> = {}) {
  const res = await fetch(`http://127.0.0.1:${port}${path}`, { headers, redirect: 'manual' });
  return { status: res.status, body: await res.text() };
}

describe('backup/browser-server', () => {
  it('serves the login page', async () => {
    server = await startServer({ port: 0, totpSecret: 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ', sessionSecret: 's', stagingRoot: STAGING });
    const port = (server.address() as { port: number }).port;
    const res = await get(port, '/login');
    expect(res.status).toBe(200);
    expect(res.body).toContain('authenticator');
  });

  it('redirects an unauthenticated / to the login page', async () => {
    server = await startServer({ port: 0, totpSecret: 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ', sessionSecret: 's', stagingRoot: STAGING });
    const port = (server.address() as { port: number }).port;
    const res = await get(port, '/');
    expect(res.status).toBe(302);
  });

  it('401s an unauthenticated /api/apps', async () => {
    server = await startServer({ port: 0, totpSecret: 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ', sessionSecret: 's', stagingRoot: STAGING });
    const port = (server.address() as { port: number }).port;
    const res = await get(port, '/api/apps', { 'X-Fleet-Backup': '1' });
    expect(res.status).toBe(401);
  });
});
