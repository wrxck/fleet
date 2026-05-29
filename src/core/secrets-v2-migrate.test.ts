import * as fs from 'node:fs';

import { describe, it, expect, vi, beforeEach } from 'vitest';

import { snapshotApp, restoreSnapshot } from './secrets-v2-snapshot.js';
import { generateKeypair, reencryptForRecipient } from './secrets-v2-keypair.js';
import { encryptCredential } from './secrets-v2-creds.js';
import { migrateComposeToV2 } from '../templates/compose-edit.js';
import { addAgentDependency } from '../templates/app-unit-edit.js';
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

export const MOCK_APP_ENTRY = {
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

export const MOCK_MANIFEST = {
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
};

export const MOCK_SNAP = {
  app: 'myapp',
  timestamp: '2026-05-06T12-00-00-000Z',
  dir: '/tmp/fleet-vault/backups/2026-05-06T12-00-00-000Z/myapp',
  manifestEntry: MOCK_MANIFEST.apps.myapp,
};

import type { ExecResult } from './exec.js';
const ok = (stdout = ''): ExecResult => ({ ok: true, stdout, stderr: '', exitCode: 0 });

export function setupHappyPath() {
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
  vi.mocked(addAgentDependency).mockImplementation((c: string) => c + '\nRequires=fleet-secrets-agent@myapp.service');
  vi.mocked(execSafe).mockImplementation((cmd: string, args: string[]) => {
    if (cmd === 'systemctl' && args.includes('is-active')) return ok('active');
    if (cmd === 'curl') return ok('200');
    return ok();
  });
}

describe('migrateAppToV2 - app not in registry', () => {
  beforeEach(() => { vi.resetAllMocks(); setupHappyPath(); vi.mocked(findApp).mockReturnValue(undefined); });

  it('throws SecretsError before any mutation when app not found', async () => {
    await expect(migrateAppToV2({ app: 'unknown' })).rejects.toThrow(/not found/i);
    expect(vi.mocked(snapshotApp)).not.toHaveBeenCalled();
  });
});

describe('migrateAppToV2 - already migrated (idempotency)', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    setupHappyPath();
    vi.mocked(loadManifest).mockReturnValue({
      version: 1,
      apps: { myapp: { ...MOCK_MANIFEST.apps.myapp, mode: 'socket' as const, recipient: 'age1pub' } },
    });
  });

  it('returns early with no snapshot and no re-encryption', async () => {
    const result = await migrateAppToV2({ app: 'myapp' });
    expect(result.rolledBack).toBeFalsy();
    expect(vi.mocked(snapshotApp)).not.toHaveBeenCalled();
    expect(vi.mocked(reencryptForRecipient)).not.toHaveBeenCalled();
  });
});

describe('migrateAppToV2 - dry run', () => {
  beforeEach(() => { vi.resetAllMocks(); setupHappyPath(); });

  it('returns snapshotDir=null and all steps ok without mutating anything', async () => {
    const result = await migrateAppToV2({ app: 'myapp', dryRun: true });
    expect(result.snapshotDir).toBeNull();
    expect(result.rolledBack).toBeFalsy();
    expect(result.steps.length).toBeGreaterThanOrEqual(11);
    expect(result.steps.every(s => s.ok)).toBeTruthy();
    expect(vi.mocked(snapshotApp)).not.toHaveBeenCalled();
    expect(vi.mocked(saveManifest)).not.toHaveBeenCalled();
    expect(vi.mocked(execSafe)).not.toHaveBeenCalled();
  });
});

describe('migrateAppToV2 - happy path (11 steps)', () => {
  beforeEach(() => { vi.resetAllMocks(); setupHappyPath(); });

  it('all 11 steps succeed: manifest mode=socket, snapshot created, no rollback', async () => {
    const result = await migrateAppToV2({ app: 'myapp' });
    expect(result.app).toBe('myapp');
    expect(result.snapshotDir).toBe(MOCK_SNAP.dir);
    expect(result.rolledBack).toBeFalsy();
    expect(result.steps.length).toBeGreaterThanOrEqual(11);
    expect(result.steps.every(s => s.ok)).toBeTruthy();
    expect(vi.mocked(snapshotApp)).toHaveBeenCalledOnce();
    expect(vi.mocked(generateKeypair)).toHaveBeenCalledOnce();
    expect(vi.mocked(reencryptForRecipient)).toHaveBeenCalledOnce();
    expect(vi.mocked(migrateComposeToV2)).toHaveBeenCalledOnce();
    expect(vi.mocked(addAgentDependency)).toHaveBeenCalledOnce();
    expect(vi.mocked(encryptCredential)).toHaveBeenCalledOnce();
    const saved = vi.mocked(saveManifest).mock.calls.at(-1)?.[0];
    expect(saved?.apps.myapp.mode).toBe('socket');
    expect(saved?.apps.myapp.recipient).toBe('age1pub');
    const sc = vi.mocked(execSafe).mock.calls.filter(c => c[0] === 'systemctl');
    expect(sc.some(c => c[1].includes('daemon-reload'))).toBeTruthy();
    expect(sc.some(c => c[1].includes('enable'))).toBeTruthy();
    expect(vi.mocked(execSafe).mock.calls.filter(c => c[0] === 'docker').length).toBeGreaterThan(0);
  });

  it('v1.bak file is written (old ciphertext moved aside)', async () => {
    await migrateAppToV2({ app: 'myapp' });
    const bakWritten =
      vi.mocked(fs.renameSync).mock.calls.some(c => c[1].toString().endsWith('.v1.bak')) ||
      vi.mocked(fs.copyFileSync).mock.calls.some(c => c[1].toString().endsWith('.v1.bak'));
    expect(bakWritten).toBeTruthy();
  });

  it('migrateComposeToV2 called with app and serviceName as 2nd and 3rd args', async () => {
    await migrateAppToV2({ app: 'myapp' });
    const call = vi.mocked(migrateComposeToV2).mock.calls[0];
    expect(call[1]).toBe('myapp');
    expect(call[2]).toBe(MOCK_APP_ENTRY.serviceName);
  });
});

describe('migrateAppToV2 - --no-restart-app', () => {
  beforeEach(() => { vi.resetAllMocks(); setupHappyPath(); });

  it('skips steps 10 and 11 without rollback', async () => {
    const result = await migrateAppToV2({ app: 'myapp', noRestartApp: true });
    expect(result.rolledBack).toBeFalsy();
    expect(result.steps.every(s => s.ok)).toBeTruthy();
    expect(result.steps.find(s => s.step === 10)?.ok).toBeTruthy();
    expect(result.steps.find(s => s.step === 11)?.ok).toBeTruthy();
    expect(vi.mocked(execSafe).mock.calls.filter(c => c[0] === 'docker').length).toBe(0);
  });
});
