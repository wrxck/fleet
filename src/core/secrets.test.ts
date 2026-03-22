import { describe, it, expect, vi, beforeEach } from 'vitest';
import { join } from 'node:path';

const VAULT_DIR = '/home/matt/fleet/vault';
const KEY_PATH = '/etc/fleet/age.key';
const MANIFEST_PATH = join(VAULT_DIR, 'manifest.json');

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

import { existsSync, copyFileSync, rmSync, readFileSync } from 'node:fs';
import { backupVaultFile, restoreVaultFile, removeBackup } from './secrets.js';

const mockExistsSync = vi.mocked(existsSync);
const mockCopyFileSync = vi.mocked(copyFileSync);
const mockRmSync = vi.mocked(rmSync);
const mockReadFileSync = vi.mocked(readFileSync);

function setupManifest(apps: Record<string, any>) {
  const manifest = JSON.stringify({ version: 1, apps });
  mockExistsSync.mockImplementation((p: any) => {
    const path = String(p);
    if (path === KEY_PATH) return true;
    if (path === VAULT_DIR) return true;
    if (path === MANIFEST_PATH) return true;
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

  it('copies encrypted file to .bak', () => {
    setupManifestWithFileExists({ myapp: testEntry });

    const result = backupVaultFile('myapp');
    const expected = join(VAULT_DIR, 'myapp.env.age.bak');

    expect(result).toBe(expected);
    expect(mockCopyFileSync).toHaveBeenCalledWith(
      join(VAULT_DIR, 'myapp.env.age'),
      expected,
    );
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

  it('copies .bak back to original and removes .bak', () => {
    setupManifestWithFileExists({ myapp: testEntry });

    const result = restoreVaultFile('myapp');

    expect(result).toBe(true);
    expect(mockCopyFileSync).toHaveBeenCalledWith(
      join(VAULT_DIR, 'myapp.env.age.bak'),
      join(VAULT_DIR, 'myapp.env.age'),
    );
    expect(mockRmSync).toHaveBeenCalledWith(
      join(VAULT_DIR, 'myapp.env.age.bak'),
      { force: true },
    );
  });

  it('returns false when no backup exists', () => {
    setupManifest({ myapp: testEntry });
    // .bak won't exist because setupManifest only returns true for key/vault/manifest paths

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

  it('removes .bak file', () => {
    setupManifest({ myapp: testEntry });

    removeBackup('myapp');
    expect(mockRmSync).toHaveBeenCalledWith(
      join(VAULT_DIR, 'myapp.env.age.bak'),
      { force: true },
    );
  });

  it('does nothing for unknown app', () => {
    setupManifest({});
    removeBackup('nonexistent');
    expect(mockRmSync).not.toHaveBeenCalled();
  });
});
