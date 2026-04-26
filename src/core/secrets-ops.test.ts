import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('node:fs', async () => {
  const actual = await vi.importActual<typeof import('node:fs')>('node:fs');
  return {
    ...actual,
    existsSync: vi.fn(),
    readFileSync: vi.fn(),
    writeFileSync: vi.fn(),
    mkdirSync: vi.fn(),
    readdirSync: vi.fn(),
    chmodSync: vi.fn(),
    statSync: vi.fn(),
    copyFileSync: vi.fn(),
    rmSync: vi.fn(),
  };
});

vi.mock('node:child_process', () => ({
  execSync: vi.fn(),
}));

vi.mock('./secrets-validate.js', () => ({
  validateAll: vi.fn(() => []),
}));

vi.mock('./secrets.js', async () => {
  const actual = await vi.importActual('./secrets.js') as Record<string, unknown>;
  return {
    ...actual,
    loadManifest: vi.fn(),
    decryptApp: vi.fn(),
    sealApp: vi.fn(),
    sealDbSecrets: vi.fn(),
    parseSecretsBundle: vi.fn(),
    ageDecryptFile: vi.fn(),
    backupVaultFile: vi.fn(),
    restoreVaultFile: vi.fn(),
    removeBackup: vi.fn(),
    isInitialized: vi.fn(() => true),
    isSealed: vi.fn(() => false),
    getPublicKey: vi.fn(() => 'age1testkey'),
    saveManifest: vi.fn(),
    VAULT_DIR: '/etc/fleet/vault',
    KEY_PATH: '/etc/fleet/age.key',
    RUNTIME_DIR: '/run/fleet-secrets',
  };
});

import { existsSync, readFileSync, readdirSync, chmodSync, writeFileSync } from 'node:fs';

import {
  loadManifest, decryptApp, sealApp, parseSecretsBundle,
  backupVaultFile, restoreVaultFile, removeBackup,
} from './secrets.js';
import { validateBeforeSeal, detectDrift, safeSealApp, unsealAll } from './secrets-ops.js';

const mockLoadManifest = vi.mocked(loadManifest);
const mockDecryptApp = vi.mocked(decryptApp);
const mockSealApp = vi.mocked(sealApp);
const mockParseSecretsBundle = vi.mocked(parseSecretsBundle);
const mockBackupVaultFile = vi.mocked(backupVaultFile);
const mockRestoreVaultFile = vi.mocked(restoreVaultFile);
const mockRemoveBackup = vi.mocked(removeBackup);
const mockExistsSync = vi.mocked(existsSync);
const mockReadFileSync = vi.mocked(readFileSync);
const mockReaddirSync = vi.mocked(readdirSync);

describe('validateBeforeSeal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('accepts adding new keys', () => {
    mockLoadManifest.mockReturnValue({
      version: 1,
      apps: {
        myapp: {
          type: 'env', encryptedFile: 'myapp.env.age',
          sourceFile: '.env', lastSealedAt: '', keyCount: 2,
        },
      },
    });
    mockDecryptApp.mockReturnValue('DB_HOST=localhost\nDB_PORT=5432');

    const result = validateBeforeSeal('myapp', 'DB_HOST=localhost\nDB_PORT=5432\nDB_NAME=prod');
    expect(result.added).toEqual(['DB_NAME']);
    expect(result.removed).toEqual([]);
    expect(result.unchanged).toEqual(['DB_HOST', 'DB_PORT']);
  });

  it('accepts removing a small number of keys', () => {
    mockLoadManifest.mockReturnValue({
      version: 1,
      apps: {
        myapp: {
          type: 'env', encryptedFile: 'myapp.env.age',
          sourceFile: '.env', lastSealedAt: '', keyCount: 4,
        },
      },
    });
    mockDecryptApp.mockReturnValue('A=1\nB=2\nC=3\nD=4');

    const result = validateBeforeSeal('myapp', 'A=1\nB=2\nC=3');
    expect(result.removed).toEqual(['D']);
    expect(result.unchanged).toEqual(['A', 'B', 'C']);
  });

  it('rejects mass deletion (>50% keys removed)', () => {
    mockLoadManifest.mockReturnValue({
      version: 1,
      apps: {
        myapp: {
          type: 'env', encryptedFile: 'myapp.env.age',
          sourceFile: '.env', lastSealedAt: '', keyCount: 4,
        },
      },
    });
    mockDecryptApp.mockReturnValue('A=1\nB=2\nC=3\nD=4');

    expect(() => validateBeforeSeal('myapp', 'A=1'))
      .toThrow('Seal rejected');
  });

  it('allows all keys for a new app', () => {
    mockLoadManifest.mockReturnValue({ version: 1, apps: {} });

    const result = validateBeforeSeal('newapp', 'X=1\nY=2');
    expect(result.added).toEqual(['X', 'Y']);
    expect(result.removed).toEqual([]);
  });
});

describe('detectDrift', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('reports in-sync when vault and runtime match', () => {
    mockLoadManifest.mockReturnValue({
      version: 1,
      apps: {
        myapp: {
          type: 'env', encryptedFile: 'myapp.env.age',
          sourceFile: '.env', lastSealedAt: '', keyCount: 2,
        },
      },
    });
    mockExistsSync.mockReturnValue(true);
    mockDecryptApp.mockReturnValue('DB_HOST=localhost\nDB_PORT=5432');
    mockReadFileSync.mockReturnValue('DB_HOST=localhost\nDB_PORT=5432');

    const results = detectDrift('myapp');
    expect(results).toHaveLength(1);
    expect(results[0].status).toBe('in-sync');
    expect(results[0].addedKeys).toEqual([]);
    expect(results[0].removedKeys).toEqual([]);
    expect(results[0].changedKeys).toEqual([]);
  });

  it('reports drifted when runtime has changes', () => {
    mockLoadManifest.mockReturnValue({
      version: 1,
      apps: {
        myapp: {
          type: 'env', encryptedFile: 'myapp.env.age',
          sourceFile: '.env', lastSealedAt: '', keyCount: 2,
        },
      },
    });
    mockExistsSync.mockReturnValue(true);
    mockDecryptApp.mockReturnValue('DB_HOST=localhost\nDB_PORT=5432');
    mockReadFileSync.mockReturnValue('DB_HOST=production\nDB_PORT=5432\nDB_NAME=prod');

    const results = detectDrift('myapp');
    expect(results[0].status).toBe('drifted');
    expect(results[0].addedKeys).toEqual(['DB_NAME']);
    expect(results[0].changedKeys).toEqual(['DB_HOST']);
  });

  it('reports missing-runtime when no runtime file', () => {
    mockLoadManifest.mockReturnValue({
      version: 1,
      apps: {
        myapp: {
          type: 'env', encryptedFile: 'myapp.env.age',
          sourceFile: '.env', lastSealedAt: '', keyCount: 2,
        },
      },
    });
    mockExistsSync.mockReturnValue(false);

    const results = detectDrift('myapp');
    expect(results[0].status).toBe('missing-runtime');
  });

  it('detects drift for secrets-dir type', () => {
    mockLoadManifest.mockReturnValue({
      version: 1,
      apps: {
        mydb: {
          type: 'secrets-dir', encryptedFile: 'mydb.secrets.age',
          sourceFile: '/secrets', lastSealedAt: '', keyCount: 2,
          files: ['password.txt', 'user.txt'],
        },
      },
    });
    // First call: runtime dir exists
    mockExistsSync.mockReturnValue(true);
    mockDecryptApp.mockReturnValue('bundled');
    mockParseSecretsBundle.mockReturnValue({ 'password.txt': 'oldpass', 'user.txt': 'admin' });
    mockReaddirSync.mockReturnValue(['password.txt', 'user.txt', 'new.txt'] as any);
    mockReadFileSync.mockImplementation((path: any) => {
      if (String(path).includes('password.txt')) return 'newpass';
      if (String(path).includes('user.txt')) return 'admin';
      if (String(path).includes('new.txt')) return 'data';
      return '';
    });

    const results = detectDrift('mydb');
    expect(results[0].status).toBe('drifted');
    expect(results[0].addedKeys).toEqual(['new.txt']);
    expect(results[0].changedKeys).toEqual(['password.txt']);
  });
});

describe('safeSealApp', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('backs up, seals, and removes backup on success', () => {
    mockLoadManifest.mockReturnValue({
      version: 1,
      apps: {
        myapp: {
          type: 'env', encryptedFile: 'myapp.env.age',
          sourceFile: '.env', lastSealedAt: '', keyCount: 2,
        },
      },
    });
    mockDecryptApp.mockReturnValue('A=1\nB=2');
    mockBackupVaultFile.mockReturnValue('/vault/myapp.env.age.bak');

    const result = safeSealApp('myapp', 'A=1\nB=2\nC=3', '.env');

    expect(mockBackupVaultFile).toHaveBeenCalledWith('myapp');
    expect(mockSealApp).toHaveBeenCalledWith('myapp', 'A=1\nB=2\nC=3', '.env');
    expect(mockRemoveBackup).toHaveBeenCalledWith('myapp');
    expect(result.added).toEqual(['C']);
  });

  it('restores backup on seal failure', () => {
    mockLoadManifest.mockReturnValue({
      version: 1,
      apps: {
        myapp: {
          type: 'env', encryptedFile: 'myapp.env.age',
          sourceFile: '.env', lastSealedAt: '', keyCount: 2,
        },
      },
    });
    mockDecryptApp.mockReturnValue('A=1\nB=2');
    mockBackupVaultFile.mockReturnValue('/vault/myapp.env.age.bak');
    mockSealApp.mockImplementation(() => { throw new Error('encryption failed'); });

    expect(() => safeSealApp('myapp', 'A=1\nB=2\nC=3', '.env')).toThrow('encryption failed');
    expect(mockRestoreVaultFile).toHaveBeenCalledWith('myapp');
    expect(mockRemoveBackup).not.toHaveBeenCalled();
  });
});

describe('unsealAll runtime perms', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('writes secrets-dir files with mode 0o644 so non-root containers can read them', async () => {
    mockLoadManifest.mockReturnValue({
      version: 1,
      apps: {
        'docker-databases': {
          type: 'secrets-dir',
          encryptedFile: 'docker-databases.secrets.age',
          sourceFile: '/srv/docker-databases/secrets',
          files: ['mongo_root_password.txt'],
          lastSealedAt: '',
          keyCount: 1,
        },
      },
    });
    const { ageDecryptFile } = await import('./secrets.js');
    vi.mocked(ageDecryptFile).mockReturnValue('---SECRET:mongo_root_password.txt---\nhunter2');
    mockParseSecretsBundle.mockReturnValue({ 'mongo_root_password.txt': 'hunter2' });
    mockExistsSync.mockReturnValue(true);

    unsealAll();

    const chmodCalls = vi.mocked(chmodSync).mock.calls;
    const secretFileCall = chmodCalls.find(
      ([p]) => typeof p === 'string' && p.endsWith('mongo_root_password.txt'),
    );
    expect(secretFileCall).toBeDefined();
    // 0o644 — group-only (0o640) breaks mongo's entrypoint, which reads the
    // password file as uid 999 without first becoming root the way postgres does
    expect(secretFileCall![1]).toBe(0o644);
  });

  it('still writes env files with 0o600 (only the runtime process needs them)', async () => {
    mockLoadManifest.mockReturnValue({
      version: 1,
      apps: {
        myapp: {
          type: 'env',
          encryptedFile: 'myapp.env.age',
          sourceFile: '.env',
          lastSealedAt: '',
          keyCount: 1,
        },
      },
    });
    const { ageDecryptFile } = await import('./secrets.js');
    vi.mocked(ageDecryptFile).mockReturnValue('FOO=bar');
    mockExistsSync.mockReturnValue(true);

    unsealAll();

    const chmodCalls = vi.mocked(chmodSync).mock.calls;
    const envCall = chmodCalls.find(
      ([p]) => typeof p === 'string' && p.endsWith('/myapp/.env'),
    );
    expect(envCall).toBeDefined();
    expect(envCall![1]).toBe(0o600);
  });
});
