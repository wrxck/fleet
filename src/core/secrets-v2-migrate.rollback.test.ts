import * as fs from 'node:fs';

import { describe, it, expect, vi, beforeEach } from 'vitest';

import { snapshotApp, restoreSnapshot } from './secrets-v2-snapshot.js';
import { generateKeypair, reencryptForRecipient } from './secrets-v2-keypair.js';
import { encryptCredential, removeCredential } from './secrets-v2-creds.js';
import { migrateComposeToV2 } from '../templates/compose-edit.js';
import { saveManifest, loadManifest } from './secrets.js';
import { findApp, load } from './registry.js';
import { execSafe } from './exec.js';
import { migrateAppToV2 } from './secrets-v2-migrate.js';

vi.mock('./secrets-v2-snapshot.js', () => ({
  snapshotApp: vi.fn(),
  restoreSnapshot: vi.fn(),
}));
vi.mock('./secrets-v2-keypair.js', () => ({
  generateKeypair: vi.fn(),
  reencryptForRecipient: vi.fn(),
}));
vi.mock('./secrets-v2-creds.js', () => ({
  encryptCredential: vi.fn(),
  credentialPathFor: vi.fn((app: string) => `/etc/fleet/credentials/${app}.cred`),
  removeCredential: vi.fn(),
}));
vi.mock('../templates/agent-unit.js', () => ({
  generateAgentUnit: vi.fn(() => '[Unit]\nDescription=Fleet Secrets Agent for %i\n'),
}));
vi.mock('../templates/compose-edit.js', () => ({
  migrateComposeToV2: vi.fn((c: string) => c + '\n# v2'),
  revertComposeFromV2: vi.fn((c: string) => c),
}));
vi.mock('../templates/app-unit-edit.js', () => ({
  addAgentDependency: vi.fn((c: string) => c + '\nRequires=fleet-secrets-agent@app.service'),
  removeAgentDependency: vi.fn((c: string) => c),
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
vi.mock('node:fs', async (importOriginal) => {
  const real = await importOriginal<typeof import('node:fs')>();
  return {
    ...real,
    existsSync: vi.fn(real.existsSync),
    readFileSync: vi.fn(real.readFileSync),
    writeFileSync: vi.fn(),
    renameSync: vi.fn(),
    copyFileSync: vi.fn(),
    mkdirSync: vi.fn(),
    chmodSync: vi.fn(),
  };
});

import type { ExecResult } from './exec.js';
const ok = (stdout = ''): ExecResult => ({ ok: true, stdout, stderr: '', exitCode: 0 });
const fail = (stderr = 'err'): ExecResult => ({ ok: false, stdout: '', stderr, exitCode: 1 });

const MOCK_APP_ENTRY = {
  name: 'myapp',
  displayName: 'My App',
  composePath: '/home/matt/myapp',
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

const MOCK_MANIFEST = {
  version: 1,
  apps: {
    myapp: {
      type: 'env' as const,
      encryptedFile: 'myapp.env.age',
      sourceFile: '/home/matt/myapp/.env',
      lastSealedAt: '2026-01-01T00:00:00.000Z',
      keyCount: 3,
      mode: 'unseal' as const,
    },
  },
};

const MOCK_SNAP = {
  app: 'myapp',
  timestamp: '2026-05-06T12-00-00-000Z',
  dir: '/tmp/fleet-vault/backups/2026-05-06T12-00-00-000Z/myapp',
  manifestEntry: MOCK_MANIFEST.apps.myapp,
};

function setupHappyPath() {
  vi.mocked(load).mockReturnValue({
    version: 1,
    apps: [MOCK_APP_ENTRY],
    infrastructure: { databases: { serviceName: 'db', composePath: '' }, nginx: { configPath: '' } },
  });
  vi.mocked(findApp).mockReturnValue(MOCK_APP_ENTRY);
  vi.mocked(snapshotApp).mockReturnValue(MOCK_SNAP);
  vi.mocked(generateKeypair).mockReturnValue({ publicKey: 'age1pub', privateKey: 'AGE-SECRET-KEY-1PRIVATE' });
  vi.mocked(reencryptForRecipient).mockReturnValue('NEW-CIPHERTEXT');
  vi.mocked(loadManifest).mockReturnValue(JSON.parse(JSON.stringify(MOCK_MANIFEST)));
  vi.mocked(saveManifest).mockReturnValue(undefined);
  vi.mocked(encryptCredential).mockReturnValue(undefined);
  vi.mocked(fs.existsSync).mockImplementation((p: fs.PathLike) => {
    const s = p.toString();
    if (s === '/etc/systemd/system/fleet-secrets-agent@.service') return false;
    if (s.includes('docker-compose.yml')) return true;
    if (s.includes('myapp.service')) return true;
    if (s.includes('/run/fleet-secrets/myapp.sock')) return true;
    if (s.includes('myapp.env.age')) return true;
    return false;
  });
  vi.mocked(fs.readFileSync).mockImplementation((p: fs.PathLike | number) => {
    const s = p.toString();
    if (s.includes('docker-compose.yml')) return 'services:\n  myapp:\n    image: myapp\n';
    if (s.includes('myapp.service')) return '[Unit]\nDescription=myapp\n[Service]\nExecStart=/bin/true\n';
    if (s.includes('myapp.env.age')) return 'OLD-CIPHERTEXT';
    return '';
  });
  vi.mocked(fs.writeFileSync).mockReturnValue(undefined);
  vi.mocked(fs.renameSync).mockReturnValue(undefined);
  vi.mocked(fs.copyFileSync).mockReturnValue(undefined);
  vi.mocked(migrateComposeToV2).mockImplementation((c: string) => c + '\n# v2-migrated');
  vi.mocked(execSafe).mockImplementation((cmd: string, args: string[]) => {
    if (cmd === 'systemctl' && args.includes('is-active')) return ok('active');
    if (cmd === 'curl') return ok('200');
    return ok();
  });
}

describe('migrateAppToV2 rollback - step 2 (keygen throws)', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    setupHappyPath();
    vi.mocked(generateKeypair).mockImplementation(() => { throw new Error('keygen failed'); });
  });

  it('calls restoreSnapshot and does not mutate manifest', async () => {
    const result = await migrateAppToV2({ app: 'myapp' });
    expect(result.rolledBack).toBeTruthy();
    expect(vi.mocked(restoreSnapshot)).toHaveBeenCalledOnce();
    expect(vi.mocked(saveManifest)).not.toHaveBeenCalled();
  });
});

describe('migrateAppToV2 rollback - step 3 (re-encrypt throws)', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    setupHappyPath();
    vi.mocked(reencryptForRecipient).mockImplementation(() => { throw new Error('reencrypt failed'); });
  });

  it('calls restoreSnapshot when re-encrypt fails', async () => {
    const result = await migrateAppToV2({ app: 'myapp' });
    expect(result.rolledBack).toBeTruthy();
    expect(vi.mocked(restoreSnapshot)).toHaveBeenCalledOnce();
    expect(vi.mocked(saveManifest)).not.toHaveBeenCalled();
  });
});

describe('migrateAppToV2 rollback - step 5 (compose edit throws)', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    setupHappyPath();
    vi.mocked(migrateComposeToV2).mockImplementation(() => { throw new Error('compose edit failed'); });
  });

  it('calls restoreSnapshot when compose migration fails', async () => {
    const result = await migrateAppToV2({ app: 'myapp' });
    expect(result.rolledBack).toBeTruthy();
    expect(vi.mocked(restoreSnapshot)).toHaveBeenCalledOnce();
  });
});

describe('migrateAppToV2 rollback - step 8 (encryptCredential throws)', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    setupHappyPath();
    vi.mocked(encryptCredential).mockImplementation(() => { throw new Error('cred encrypt failed'); });
  });

  it('calls restoreSnapshot and does not leave credential file behind', async () => {
    const result = await migrateAppToV2({ app: 'myapp' });
    expect(result.rolledBack).toBeTruthy();
    expect(vi.mocked(restoreSnapshot)).toHaveBeenCalledOnce();
    expect(vi.mocked(removeCredential)).not.toHaveBeenCalled();
  });
});

describe('migrateAppToV2 rollback - step 9 (systemctl is-active returns inactive)', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    setupHappyPath();
    vi.mocked(execSafe).mockImplementation((cmd: string, args: string[]) => {
      if (cmd === 'systemctl' && args.includes('is-active')) return ok('inactive');
      if (cmd === 'curl') return ok('200');
      return ok();
    });
  });

  it('calls restoreSnapshot and disables agent unit in rollback', async () => {
    const result = await migrateAppToV2({ app: 'myapp' });
    expect(result.rolledBack).toBeTruthy();
    expect(vi.mocked(restoreSnapshot)).toHaveBeenCalledOnce();
    const disableCalls = vi.mocked(execSafe).mock.calls.filter(
      c => c[0] === 'systemctl' && c[1].includes('disable'),
    );
    expect(disableCalls.length).toBeGreaterThan(0);
  });
});

describe('migrateAppToV2 rollback - step 11 (curl healthcheck times out)', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    setupHappyPath();
    vi.mocked(execSafe).mockImplementation((cmd: string, args: string[]) => {
      if (cmd === 'systemctl' && args.includes('is-active')) return ok('active');
      if (cmd === 'curl') return fail('connection refused');
      return ok();
    });
    vi.spyOn(Date, 'now')
      .mockReturnValueOnce(0)
      .mockReturnValue(31_000);
  });

  it('calls restoreSnapshot and re-runs docker compose for v1 restart', async () => {
    const result = await migrateAppToV2({ app: 'myapp' });
    expect(result.rolledBack).toBeTruthy();
    expect(vi.mocked(restoreSnapshot)).toHaveBeenCalledOnce();
    const dockerCalls = vi.mocked(execSafe).mock.calls.filter(c => c[0] === 'docker');
    expect(dockerCalls.length).toBeGreaterThanOrEqual(2);
  });
});
