import * as fs from 'node:fs';

import { describe, it, expect, vi, beforeEach } from 'vitest';

import { listSnapshots, restoreSnapshot } from './secrets-v2-snapshot.js';
import { removeCredential } from './secrets-v2-creds.js';
import { loadManifest } from './secrets.js';
import { findApp, load } from './registry.js';
import { execSafe } from './exec.js';
import { validateApp } from './secrets-validate.js';
import { revertAppFromV2 } from './secrets-v2-migrate.js';

vi.mock('./secrets-v2-snapshot.js', () => ({
  snapshotApp: vi.fn(),
  restoreSnapshot: vi.fn(),
  listSnapshots: vi.fn(),
}));
vi.mock('./secrets-v2-creds.js', () => ({
  encryptCredential: vi.fn(),
  credentialPathFor: vi.fn((app: string) => `/etc/fleet/credentials/${app}.cred`),
  removeCredential: vi.fn(),
}));
vi.mock('./secrets.js', () => ({
  loadManifest: vi.fn(),
  saveManifest: vi.fn(),
  VAULT_DIR: '/tmp/fleet-vault',
}));
vi.mock('./registry.js', () => ({
  findApp: vi.fn(),
  load: vi.fn(),
}));
vi.mock('./exec.js', () => ({ execSafe: vi.fn() }));
vi.mock('./secrets-validate.js', () => ({ validateApp: vi.fn() }));
vi.mock('node:fs', async (importOriginal) => {
  const real = await importOriginal<typeof import('node:fs')>();
  return {
    ...real,
    existsSync: vi.fn(real.existsSync),
    unlinkSync: vi.fn(),
  };
});

import type { ExecResult } from './exec.js';
const ok = (stdout = ''): ExecResult => ({ ok: true, stdout, stderr: '', exitCode: 0 });

const MOCK_APP_ENTRY = {
  name: 'myapp',
  displayName: 'My App',
  composePath: '/srv/test-app',
  composeFile: 'docker-compose.yml',
  serviceName: 'myapp',
  domains: [],
  port: 8080,
  usesSharedDb: false,
  type: 'service' as const,
  containers: ['myapp'],
  dependsOnDatabases: false,
  registeredAt: '2026-01-01T00:00:00.000Z',
};

const MOCK_SNAP = {
  app: 'myapp',
  timestamp: '2026-05-06T12-00-00-000Z',
  dir: '/tmp/fleet-vault/backups/2026-05-06T12-00-00-000Z/myapp',
  manifestEntry: { mode: 'unseal', encryptedFile: 'myapp.env.age' },
};

const MOCK_SNAP_OLDER = {
  app: 'myapp',
  timestamp: '2026-05-05T08-00-00-000Z',
  dir: '/tmp/fleet-vault/backups/2026-05-05T08-00-00-000Z/myapp',
  manifestEntry: { mode: 'unseal', encryptedFile: 'myapp.env.age' },
};

function setupHappyPath() {
  vi.mocked(load).mockReturnValue({
    version: 1,
    apps: [MOCK_APP_ENTRY],
    infrastructure: { databases: { serviceName: 'db', composePath: '' }, nginx: { configPath: '' } },
  });
  vi.mocked(findApp).mockReturnValue(MOCK_APP_ENTRY);
  vi.mocked(loadManifest).mockReturnValue({
    version: 1,
    apps: {
      myapp: {
        type: 'env' as const,
        encryptedFile: 'myapp.env.age',
        sourceFile: '/srv/test-app/.env',
        lastSealedAt: '2026-01-01T00:00:00.000Z',
        keyCount: 3,
        mode: 'socket' as const,
        recipient: 'age1pub',
      },
    },
  });
  vi.mocked(listSnapshots).mockReturnValue([MOCK_SNAP, MOCK_SNAP_OLDER]);
  vi.mocked(restoreSnapshot).mockReturnValue(undefined);
  vi.mocked(removeCredential).mockReturnValue(undefined);
  vi.mocked(validateApp).mockReturnValue({ app: 'myapp', ok: true, missing: [], extra: [] });
  vi.mocked(execSafe).mockReturnValue(ok());
  vi.mocked(fs.existsSync).mockReturnValue(false);
}

// 1. happy path
describe('revertAppFromV2 - happy path', () => {
  beforeEach(() => { vi.resetAllMocks(); setupHappyPath(); });

  it('returns ok=true with snapshot timestamp and 7 steps all passing', async () => {
    const result = await revertAppFromV2({ app: 'myapp' });
    expect(result.ok).toBeTruthy();
    expect(result.app).toBe('myapp');
    expect(result.snapshotUsed).toBe(MOCK_SNAP.timestamp);
    expect(result.steps.length).toBeGreaterThanOrEqual(7);
    expect(result.steps.every(s => s.ok)).toBeTruthy();
    expect(vi.mocked(restoreSnapshot)).toHaveBeenCalledOnce();
    expect(vi.mocked(validateApp)).toHaveBeenCalledWith('myapp');
    const dockerCalls = vi.mocked(execSafe).mock.calls.filter(c => c[0] === 'docker');
    expect(dockerCalls.length).toBeGreaterThan(0);
  });
});

// 2. app not in registry
describe('revertAppFromV2 - app not in registry', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    setupHappyPath();
    vi.mocked(findApp).mockReturnValue(undefined);
  });

  it('throws SecretsError without touching snapshots', async () => {
    await expect(revertAppFromV2({ app: 'unknown' })).rejects.toThrow(/not found/i);
    expect(vi.mocked(listSnapshots)).not.toHaveBeenCalled();
  });
});

// 3. app not in v2 mode
describe('revertAppFromV2 - app not in v2 mode', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    setupHappyPath();
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

  it('throws because app is already in unseal mode', async () => {
    await expect(revertAppFromV2({ app: 'myapp' })).rejects.toThrow();
    expect(vi.mocked(restoreSnapshot)).not.toHaveBeenCalled();
  });
});

// 4. no snapshots available
describe('revertAppFromV2 - no snapshots', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    setupHappyPath();
    vi.mocked(listSnapshots).mockReturnValue([]);
  });

  it('throws because there are no snapshots to revert from', async () => {
    await expect(revertAppFromV2({ app: 'myapp' })).rejects.toThrow(/no snapshot/i);
    expect(vi.mocked(restoreSnapshot)).not.toHaveBeenCalled();
  });
});

// 5. specific snapshot timestamp requested
describe('revertAppFromV2 - specific snapshot timestamp', () => {
  beforeEach(() => { vi.resetAllMocks(); setupHappyPath(); });

  it('uses the exact snapshot matching the requested timestamp', async () => {
    const result = await revertAppFromV2({ app: 'myapp', snapshotTimestamp: MOCK_SNAP_OLDER.timestamp });
    expect(result.ok).toBeTruthy();
    expect(result.snapshotUsed).toBe(MOCK_SNAP_OLDER.timestamp);
    const [, snap] = vi.mocked(restoreSnapshot).mock.calls[0];
    expect(snap.timestamp).toBe(MOCK_SNAP_OLDER.timestamp);
  });
});

// 6. systemctl disable failure is best-effort
describe('revertAppFromV2 - systemctl disable failure is best-effort', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    setupHappyPath();
    vi.mocked(execSafe).mockImplementation((cmd: string, args: string[]) => {
      if (cmd === 'systemctl' && args.includes('disable')) {
        return { ok: false, stdout: '', stderr: 'unit not found', exitCode: 5 };
      }
      return ok();
    });
  });

  it('continues and calls restoreSnapshot despite disable failure', async () => {
    const result = await revertAppFromV2({ app: 'myapp' });
    expect(result.ok).toBeTruthy();
    const disableStep = result.steps.find(s => s.step === 1);
    expect(disableStep?.ok).toBeFalsy();
    expect(disableStep?.detail).toMatch(/unit not found/);
    expect(vi.mocked(restoreSnapshot)).toHaveBeenCalledOnce();
  });
});

// 6b. removeCredential exception recorded as ok:false but does not abort
describe('revertAppFromV2 - removeCredential exception is best-effort', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    setupHappyPath();
    vi.mocked(removeCredential).mockImplementationOnce(() => {
      throw new Error('credential file is read-only');
    });
  });

  it('best-effort: removeCredential exception is recorded as ok:false but does not abort', async () => {
    const result = await revertAppFromV2({ app: 'myapp' });
    const removeCredStep = result.steps.find(s => s.step === 2);
    expect(removeCredStep?.ok).toBeFalsy();
    expect(removeCredStep?.detail).toMatch(/read-only/);
    expect(vi.mocked(restoreSnapshot)).toHaveBeenCalled();
  });
});

// 7. restoreSnapshot failure propagates
describe('revertAppFromV2 - restoreSnapshot failure', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    setupHappyPath();
    vi.mocked(restoreSnapshot).mockImplementation(() => { throw new Error('disk full'); });
  });

  it('propagates the error with a failed step recorded', async () => {
    await expect(revertAppFromV2({ app: 'myapp' })).rejects.toThrow(/disk full/);
  });
});

// 8. validateApp returns missing keys
describe('revertAppFromV2 - validateApp returns missing keys', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    setupHappyPath();
    vi.mocked(validateApp).mockReturnValue({
      app: 'myapp',
      ok: false,
      missing: ['DATABASE_URL', 'API_KEY'],
      extra: [],
    });
  });

  it('throws with the missing key names in the error message', async () => {
    await expect(revertAppFromV2({ app: 'myapp' })).rejects.toThrow(/DATABASE_URL|API_KEY/);
  });
});
