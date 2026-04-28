import { describe, it, expect, vi, beforeEach } from 'vitest';
import { join } from 'node:path';

const KEY_PATH = '/etc/fleet/age.key';

// Mock fs and child_process before importing
vi.mock('node:fs', async () => {
  const actual = await vi.importActual<typeof import('node:fs')>('node:fs');
  return {
    ...actual,
    existsSync: vi.fn(),
    copyFileSync: vi.fn(),
    rmSync: vi.fn(),
    readFileSync: vi.fn(),
    writeFileSync: vi.fn(),
    mkdirSync: vi.fn(),
    readdirSync: vi.fn(),
    chmodSync: vi.fn(),
    statSync: vi.fn(),
  };
});

vi.mock('node:child_process', () => ({
  execSync: vi.fn(),
}));

import { existsSync, copyFileSync, rmSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { backupVaultFile, restoreVaultFile, removeBackup, VAULT_DIR } from './secrets.js';

const mockExistsSync = vi.mocked(existsSync);
const mockCopyFileSync = vi.mocked(copyFileSync);
const mockRmSync = vi.mocked(rmSync);
const mockReadFileSync = vi.mocked(readFileSync);
const mockReaddirSync = vi.mocked(readdirSync);
const mockStatSync = vi.mocked(statSync);

function setupManifest(apps: Record<string, any>) {
  const manifest = JSON.stringify({ version: 1, apps });
  mockExistsSync.mockImplementation((p: any) => {
    const path = String(p);
    if (path === KEY_PATH) return true;
    if (path === VAULT_DIR) return true;
    if (path === join(VAULT_DIR, 'manifest.json')) return true;
    return false;
  });
  mockReadFileSync.mockReturnValue(manifest);
}

function setupManifestWithFileExists(apps: Record<string, any>) {
  const manifest = JSON.stringify({ version: 1, apps });
  mockExistsSync.mockImplementation((p: any) => {
    // everything exists
    return true;
  });
  mockReadFileSync.mockReturnValue(manifest);
}

const testEntry = {
  type: 'env',
  encryptedFile: 'myapp.env.age',
  sourceFile: '/apps/myapp/.env',
  lastSealedAt: '2025-01-01T00:00:00.000Z',
  keyCount: 5,
};

describe('backupVaultFile', () => {
  beforeEach(() => vi.clearAllMocks());

  it('copies encrypted file to a per-op .bak-<tag> path', () => {
    setupManifestWithFileExists({ myapp: testEntry });

    const result = backupVaultFile('myapp', 'op-A');
    const expected = join(VAULT_DIR, 'myapp.env.age.bak-op-A');

    expect(result).toBe(expected);
    expect(mockCopyFileSync).toHaveBeenCalledWith(
      join(VAULT_DIR, 'myapp.env.age'),
      expected,
    );
  });

  it('generates a unique default tag per call (PID + timestamp + counter) so concurrent ops do not collide', () => {
    setupManifestWithFileExists({ myapp: testEntry });

    const a = backupVaultFile('myapp');
    const b = backupVaultFile('myapp');

    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    expect(a).not.toBe(b);
    // Both should land under VAULT_DIR with the .bak- prefix
    expect(a).toMatch(/myapp\.env\.age\.bak-/);
    expect(b).toMatch(/myapp\.env\.age\.bak-/);
  });

  it('returns null when app not in manifest', () => {
    setupManifest({});
    expect(backupVaultFile('nonexistent')).toBeNull();
    expect(mockCopyFileSync).not.toHaveBeenCalled();
  });

  it('returns null when encrypted file does not exist', () => {
    setupManifest({ myapp: testEntry });
    // existsSync returns false for the encrypted file (manifest/key paths return true via setupManifest)

    expect(backupVaultFile('myapp')).toBeNull();
    expect(mockCopyFileSync).not.toHaveBeenCalled();
  });
});

describe('restoreVaultFile', () => {
  beforeEach(() => vi.clearAllMocks());

  it('restores from the explicit bak path supplied by the caller', () => {
    setupManifestWithFileExists({ myapp: testEntry });
    const bakPath = join(VAULT_DIR, 'myapp.env.age.bak-explicit');

    const result = restoreVaultFile('myapp', bakPath);

    expect(result).toBe(true);
    expect(mockCopyFileSync).toHaveBeenCalledWith(
      bakPath,
      join(VAULT_DIR, 'myapp.env.age'),
    );
    expect(mockRmSync).toHaveBeenCalledWith(bakPath, { force: true });
  });

  it('with no path falls back to scanning vault/ and picks the newest .bak-* matching the app', () => {
    setupManifestWithFileExists({ myapp: testEntry });
    // Three backups for myapp + one for another app — newest of myapp's is bak-3
    mockReaddirSync.mockReturnValue([
      'myapp.env.age.bak-1',
      'myapp.env.age.bak-2',
      'myapp.env.age.bak-3',
      'otherapp.env.age.bak-99',
    ] as any);
    mockStatSync.mockImplementation((p: any) => {
      const path = String(p);
      if (path.endsWith('bak-1')) return { mtimeMs: 1000 } as any;
      if (path.endsWith('bak-2')) return { mtimeMs: 2000 } as any;
      if (path.endsWith('bak-3')) return { mtimeMs: 3000 } as any;
      if (path.endsWith('bak-99')) return { mtimeMs: 9999 } as any;
      return { mtimeMs: 0 } as any;
    });

    const result = restoreVaultFile('myapp');
    const expectedBak = join(VAULT_DIR, 'myapp.env.age.bak-3');

    expect(result).toBe(true);
    expect(mockCopyFileSync).toHaveBeenCalledWith(
      expectedBak,
      join(VAULT_DIR, 'myapp.env.age'),
    );
    expect(mockRmSync).toHaveBeenCalledWith(expectedBak, { force: true });
  });

  it('returns false when no backup exists', () => {
    setupManifest({ myapp: testEntry });
    mockReaddirSync.mockReturnValue([] as any);

    expect(restoreVaultFile('myapp')).toBe(false);
    expect(mockCopyFileSync).not.toHaveBeenCalled();
  });

  it('returns false when app not in manifest', () => {
    setupManifest({});
    expect(restoreVaultFile('nonexistent')).toBe(false);
  });
});

describe('removeBackup', () => {
  beforeEach(() => vi.clearAllMocks());

  it('removes the explicit bak path supplied by the caller', () => {
    setupManifest({ myapp: testEntry });
    const bakPath = join(VAULT_DIR, 'myapp.env.age.bak-explicit');

    removeBackup('myapp', bakPath);
    expect(mockRmSync).toHaveBeenCalledWith(bakPath, { force: true });
  });

  it('with no path scans vault/ for the newest .bak-* and removes it', () => {
    setupManifestWithFileExists({ myapp: testEntry });
    mockReaddirSync.mockReturnValue([
      'myapp.env.age.bak-1',
      'myapp.env.age.bak-2',
    ] as any);
    mockStatSync.mockImplementation((p: any) => {
      const path = String(p);
      if (path.endsWith('bak-1')) return { mtimeMs: 1000 } as any;
      if (path.endsWith('bak-2')) return { mtimeMs: 2000 } as any;
      return { mtimeMs: 0 } as any;
    });

    removeBackup('myapp');
    expect(mockRmSync).toHaveBeenCalledWith(
      join(VAULT_DIR, 'myapp.env.age.bak-2'),
      { force: true },
    );
  });

  it('does nothing for unknown app when no path is supplied', () => {
    setupManifest({});
    removeBackup('nonexistent');
    expect(mockRmSync).not.toHaveBeenCalled();
  });
});
