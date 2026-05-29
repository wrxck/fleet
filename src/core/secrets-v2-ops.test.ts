import * as fs from 'node:fs';
import * as net from 'node:net';
import * as os from 'node:os';
import * as path from 'node:path';

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { detectV2Drift, getV2Status } from './secrets-v2-ops.js';

vi.mock('./secrets.js', () => ({ loadManifest: vi.fn() }));
vi.mock('./secrets-v2-creds.js', () => ({
  credentialPathFor: vi.fn((app: string) => `/etc/fleet/credentials/${app}.cred`),
}));
vi.mock('./exec.js', () => ({ execSafe: vi.fn() }));
vi.mock('node:fs', async (importOriginal) => {
  const real = await importOriginal<typeof import('node:fs')>();
  return { ...real, existsSync: vi.fn(real.existsSync), statSync: vi.fn(real.statSync) };
});

import { loadManifest } from './secrets.js';
import { execSafe } from './exec.js';
import type { ExecResult } from './exec.js';

const ok = (stdout = ''): ExecResult => ({ ok: true, stdout, stderr: '', exitCode: 0 });

const SOCKET_MANIFEST = {
  version: 1,
  apps: {
    myapp: {
      type: 'env' as const,
      encryptedFile: 'myapp.env.age',
      sourceFile: '/srv/test-app/.env',
      lastSealedAt: '2026-01-01T00:00:00.000Z',
      keyCount: 3,
      mode: 'socket' as const,
      recipient: 'age1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqfqcm',
    },
  },
};

function spawnSocketServer(sockPath: string, body: string): net.Server {
  const server = net.createServer((conn) => {
    let buf = '';
    conn.on('data', (chunk) => {
      buf += chunk.toString();
      if (buf.includes('\r\n\r\n')) {
        const res = [
          'HTTP/1.1 200 OK',
          'Content-Type: application/json',
          `Content-Length: ${Buffer.byteLength(body)}`,
          '',
          body,
        ].join('\r\n');
        conn.write(res);
        conn.end();
      }
    });
  });
  server.listen(sockPath);
  return server;
}

function setupBaseMocks(sockPath: string) {
  vi.mocked(loadManifest).mockReturnValue(JSON.parse(JSON.stringify(SOCKET_MANIFEST)));
  vi.mocked(execSafe).mockImplementation((cmd: string, args: string[]) => {
    if (cmd === 'systemctl' && args.includes('is-active')) return ok('active');
    return ok();
  });
  vi.mocked(fs.existsSync).mockImplementation((p) => {
    const s = p.toString();
    if (s.endsWith('.cred')) return true;
    if (s === sockPath) return true;
    return false;
  });
  vi.mocked(fs.statSync).mockReturnValue({ mode: 0o10660 } as fs.Stats);
}

function makeTmp() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fleet-drift-'));
  return { dir, sock: path.join(dir, 'myapp.sock') };
}

describe('detectV2Drift - all checks pass', () => {
  let server: net.Server;
  let tmp: { dir: string; sock: string };

  beforeEach(() => {
    vi.resetAllMocks();
    tmp = makeTmp();
    setupBaseMocks(tmp.sock);
    server = spawnSocketServer(tmp.sock, JSON.stringify({ app: 'myapp', secrets: 3, ok: true }));
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
    fs.rmSync(tmp.dir, { recursive: true, force: true });
  });

  it('returns ok=true with all 6 checks passing', async () => {
    const result = await detectV2Drift('myapp', tmp.sock);
    expect(result.ok).toBeTruthy();
    expect(result.app).toBe('myapp');
    expect(result.checks.length).toBe(6);
    expect(result.checks.every(c => c.ok)).toBeTruthy();
  });
});

describe('detectV2Drift - mode is not socket', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(loadManifest).mockReturnValue({
      version: 1,
      apps: {
        myapp: {
          type: 'env' as const,
          encryptedFile: 'myapp.env.age',
          sourceFile: '/srv/test-app/.env',
          lastSealedAt: '2026-01-01T00:00:00.000Z',
          keyCount: 3,
          mode: 'unseal' as const,
        },
      },
    });
  });

  it('returns single mode check with ok=false', async () => {
    const result = await detectV2Drift('myapp');
    expect(result.ok).toBeFalsy();
    expect(result.checks.length).toBe(1);
    expect(result.checks[0].name).toBe('mode');
    expect(result.checks[0].ok).toBeFalsy();
  });
});

describe('detectV2Drift - recipient_matches: invalid format', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(loadManifest).mockReturnValue({
      version: 1,
      apps: { myapp: { ...SOCKET_MANIFEST.apps.myapp, recipient: 'not-an-age-key' } },
    });
    vi.mocked(execSafe).mockReturnValue(ok('active'));
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.statSync).mockReturnValue({ mode: 0o10660 } as fs.Stats);
  });

  it('recipient_matches check returns ok=false when recipient has invalid format', async () => {
    const result = await detectV2Drift('myapp');
    expect(result.ok).toBeFalsy();
    const check = result.checks.find(c => c.name === 'recipient_matches');
    expect(check!.ok).toBeFalsy();
  });
});

describe('detectV2Drift - credential_present: missing file', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(loadManifest).mockReturnValue(JSON.parse(JSON.stringify(SOCKET_MANIFEST)));
    vi.mocked(execSafe).mockReturnValue(ok('active'));
    vi.mocked(fs.existsSync).mockImplementation((p) => !p.toString().endsWith('.cred'));
    vi.mocked(fs.statSync).mockReturnValue({ mode: 0o10660 } as fs.Stats);
  });

  it('credential_present check returns ok=false when .cred file is missing', async () => {
    const result = await detectV2Drift('myapp');
    expect(result.ok).toBeFalsy();
    const check = result.checks.find(c => c.name === 'credential_present');
    expect(check!.ok).toBeFalsy();
  });
});

describe('detectV2Drift - agent_active: not active', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(loadManifest).mockReturnValue(JSON.parse(JSON.stringify(SOCKET_MANIFEST)));
    vi.mocked(execSafe).mockImplementation((cmd: string, args: string[]) => {
      if (cmd === 'systemctl' && args.includes('is-active')) return ok('inactive');
      return ok();
    });
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.statSync).mockReturnValue({ mode: 0o10660 } as fs.Stats);
  });

  it('agent_active check returns ok=false when systemctl reports inactive', async () => {
    const result = await detectV2Drift('myapp');
    expect(result.ok).toBeFalsy();
    const check = result.checks.find(c => c.name === 'agent_active');
    expect(check!.ok).toBeFalsy();
  });
});

describe('detectV2Drift - socket_present: missing', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(loadManifest).mockReturnValue(JSON.parse(JSON.stringify(SOCKET_MANIFEST)));
    vi.mocked(execSafe).mockReturnValue(ok('active'));
    vi.mocked(fs.existsSync).mockImplementation((p) => {
      if (p.toString().endsWith('.sock')) return false;
      return true;
    });
    vi.mocked(fs.statSync).mockReturnValue({ mode: 0o10660 } as fs.Stats);
  });

  it('socket_present check returns ok=false when socket file does not exist', async () => {
    const result = await detectV2Drift('myapp');
    expect(result.ok).toBeFalsy();
    const check = result.checks.find(c => c.name === 'socket_present');
    expect(check!.ok).toBeFalsy();
  });
});

describe('detectV2Drift - socket_perms: wrong mode', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(loadManifest).mockReturnValue(JSON.parse(JSON.stringify(SOCKET_MANIFEST)));
    vi.mocked(execSafe).mockReturnValue(ok('active'));
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.statSync).mockReturnValue({ mode: 0o10644 } as fs.Stats);
  });

  it('socket_perms check returns ok=false when permissions are 0o644 instead of 0o660', async () => {
    const result = await detectV2Drift('myapp');
    expect(result.ok).toBeFalsy();
    const check = result.checks.find(c => c.name === 'socket_perms');
    expect(check!.ok).toBeFalsy();
  });
});

describe('detectV2Drift - sample_fetch_keys: connection refused', () => {
  let tmp: { dir: string; sock: string };

  beforeEach(() => {
    vi.resetAllMocks();
    tmp = makeTmp();
    vi.mocked(loadManifest).mockReturnValue(JSON.parse(JSON.stringify(SOCKET_MANIFEST)));
    vi.mocked(execSafe).mockReturnValue(ok('active'));
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.statSync).mockReturnValue({ mode: 0o10660 } as fs.Stats);
  });

  afterEach(() => { fs.rmSync(tmp.dir, { recursive: true, force: true }); });

  it('sample_fetch_keys returns ok=false when no server is listening', async () => {
    const result = await detectV2Drift('myapp', tmp.sock);
    expect(result.ok).toBeFalsy();
    const check = result.checks.find(c => c.name === 'sample_fetch_keys');
    expect(check!.ok).toBeFalsy();
  });
});

describe('detectV2Drift - sample_fetch_keys: wrong app name in response', () => {
  let server: net.Server;
  let tmp: { dir: string; sock: string };

  beforeEach(() => {
    vi.resetAllMocks();
    tmp = makeTmp();
    vi.mocked(loadManifest).mockReturnValue(JSON.parse(JSON.stringify(SOCKET_MANIFEST)));
    vi.mocked(execSafe).mockReturnValue(ok('active'));
    vi.mocked(fs.existsSync).mockImplementation((p) => {
      const s = p.toString();
      if (s.endsWith('.cred')) return true;
      if (s === tmp.sock) return true;
      return false;
    });
    vi.mocked(fs.statSync).mockReturnValue({ mode: 0o10660 } as fs.Stats);
    server = spawnSocketServer(tmp.sock, JSON.stringify({ app: 'other', secrets: 5, ok: true }));
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
    fs.rmSync(tmp.dir, { recursive: true, force: true });
  });

  it('sample_fetch_keys returns ok=false when response app does not match', async () => {
    const result = await detectV2Drift('myapp', tmp.sock);
    expect(result.ok).toBeFalsy();
    const check = result.checks.find(c => c.name === 'sample_fetch_keys');
    expect(check!.ok).toBeFalsy();
    expect(check!.detail).toMatch(/app.*mismatch/i);
  });
});

// getV2Status tests

describe('getV2Status - empty manifest', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(loadManifest).mockReturnValue({ version: 1, apps: {} });
  });

  it('returns empty apps array with zero counts', () => {
    const result = getV2Status();
    expect(result.apps.length).toBe(0);
    expect(result.v1Count).toBe(0);
    expect(result.v2Count).toBe(0);
  });
});

describe('getV2Status - mixed modes', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(loadManifest).mockReturnValue({
      version: 1,
      apps: {
        app1: { type: 'env' as const, encryptedFile: 'a.age', sourceFile: '/a', lastSealedAt: '2026-01-01T00:00:00.000Z', keyCount: 1, mode: 'unseal' as const },
        app2: { type: 'env' as const, encryptedFile: 'b.age', sourceFile: '/b', lastSealedAt: '2026-01-02T00:00:00.000Z', keyCount: 2, mode: 'unseal' as const },
        app3: { type: 'env' as const, encryptedFile: 'c.age', sourceFile: '/c', lastSealedAt: '2026-01-03T00:00:00.000Z', keyCount: 3, mode: 'socket' as const, recipient: 'age1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqfqcm' },
        app4: { type: 'env' as const, encryptedFile: 'd.age', sourceFile: '/d', lastSealedAt: '2026-01-04T00:00:00.000Z', keyCount: 4, mode: 'socket' as const, recipient: 'age1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqfqcm' },
        app5: { type: 'env' as const, encryptedFile: 'e.age', sourceFile: '/e', lastSealedAt: '2026-01-05T00:00:00.000Z', keyCount: 5, mode: 'socket' as const, recipient: 'age1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqfqcm' },
      },
    });
    vi.mocked(execSafe).mockReturnValue(ok('inactive'));
    vi.mocked(fs.existsSync).mockReturnValue(false);
    vi.mocked(fs.statSync).mockReturnValue({ mode: 0o10660 } as fs.Stats);
  });

  it('counts 2 v1 and 3 v2 apps with correct modes', () => {
    const result = getV2Status();
    expect(result.apps.length).toBe(5);
    expect(result.v1Count).toBe(2);
    expect(result.v2Count).toBe(3);
    const v1Apps = result.apps.filter(a => a.mode === 'unseal');
    const v2Apps = result.apps.filter(a => a.mode === 'socket');
    expect(v1Apps.length).toBe(2);
    expect(v2Apps.length).toBe(3);
  });
});

describe('getV2Status - v1 app always false', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(loadManifest).mockReturnValue({
      version: 1,
      apps: {
        legacy: { type: 'env' as const, encryptedFile: 'l.age', sourceFile: '/l', lastSealedAt: '2026-01-01T00:00:00.000Z', keyCount: 2, mode: 'unseal' as const },
      },
    });
    // even if execSafe would return 'active' and a socket file exists, v1 should not check
    vi.mocked(execSafe).mockReturnValue(ok('active'));
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.statSync).mockReturnValue({ mode: 0o10660 } as fs.Stats);
  });

  it('v1 app has agentActive=false and socketOk=false regardless of filesystem', () => {
    const result = getV2Status();
    expect(result.apps.length).toBe(1);
    const app = result.apps[0];
    expect(app.mode).toBe('unseal');
    expect(app.agentActive).toBeFalsy();
    expect(app.socketOk).toBeFalsy();
  });
});

describe('getV2Status - v2 agent active and socket ok', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(loadManifest).mockReturnValue({
      version: 1,
      apps: {
        myapp: { ...SOCKET_MANIFEST.apps.myapp },
      },
    });
    vi.mocked(execSafe).mockImplementation((cmd: string, args: string[]) => {
      if (cmd === 'systemctl' && args.includes('is-active')) return ok('active');
      return ok();
    });
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.statSync).mockReturnValue({ mode: 0o10660 } as fs.Stats);
  });

  it('happy path: agentActive=true and socketOk=true', () => {
    const result = getV2Status();
    expect(result.v2Count).toBe(1);
    const app = result.apps[0];
    expect(app.mode).toBe('socket');
    expect(app.agentActive).toBeTruthy();
    expect(app.socketOk).toBeTruthy();
  });
});

describe('getV2Status - v2 agent inactive', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(loadManifest).mockReturnValue({
      version: 1,
      apps: {
        myapp: { ...SOCKET_MANIFEST.apps.myapp },
      },
    });
    vi.mocked(execSafe).mockImplementation((cmd: string, args: string[]) => {
      if (cmd === 'systemctl' && args.includes('is-active')) return ok('inactive');
      return ok();
    });
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.statSync).mockReturnValue({ mode: 0o10660 } as fs.Stats);
  });

  it('agentActive=false when systemctl reports inactive, socketOk checked independently', () => {
    const result = getV2Status();
    const app = result.apps[0];
    expect(app.agentActive).toBeFalsy();
    expect(app.socketOk).toBeTruthy();
  });
});

describe('getV2Status - v2 socket wrong perms', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(loadManifest).mockReturnValue({
      version: 1,
      apps: {
        myapp: { ...SOCKET_MANIFEST.apps.myapp },
      },
    });
    vi.mocked(execSafe).mockImplementation((cmd: string, args: string[]) => {
      if (cmd === 'systemctl' && args.includes('is-active')) return ok('active');
      return ok();
    });
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.statSync).mockReturnValue({ mode: 0o10644 } as fs.Stats);
  });

  it('socketOk=false when socket exists but mode is 0o644', () => {
    const result = getV2Status();
    const app = result.apps[0];
    expect(app.agentActive).toBeTruthy();
    expect(app.socketOk).toBeFalsy();
  });
});
