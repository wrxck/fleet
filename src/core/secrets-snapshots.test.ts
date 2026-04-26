import { describe, it, expect, vi, beforeEach } from 'vitest';
import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';

const { FAKE_VAULT } = vi.hoisted(() => {
  const { mkdtempSync } = require('node:fs');
  const { tmpdir } = require('node:os');
  const { join } = require('node:path');
  return { FAKE_VAULT: mkdtempSync(join(tmpdir(), 'fleet-snap-test-')) };
});

vi.mock('./secrets.js', async () => {
  const actual = await vi.importActual<any>('./secrets.js');
  return { ...actual, VAULT_DIR: FAKE_VAULT, loadManifest: vi.fn() };
});

import { join } from 'node:path';
import { snapshotApp, listSnapshots, restoreSnapshot, pruneSnapshots, getSnapshotDir } from './secrets-snapshots.js';
import { loadManifest } from './secrets.js';

const APP = 'macpool';
const ENC_FILE = 'macpool.env.age';

function setupVault(content = 'OLD CIPHERTEXT') {
  if (!existsSync(FAKE_VAULT)) mkdirSync(FAKE_VAULT, { recursive: true });
  writeFileSync(join(FAKE_VAULT, ENC_FILE), content);
  vi.mocked(loadManifest).mockReturnValue({
    version: 1,
    apps: { [APP]: { type: 'env', encryptedFile: ENC_FILE, sourceFile: '/x', lastSealedAt: '', keyCount: 1 } as any },
  });
}

describe('secrets-snapshots', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupVault();
  });

  it('snapshotApp creates a timestamped copy under .snapshots/', () => {
    const path = snapshotApp(APP);
    expect(existsSync(path)).toBe(true);
    expect(path).toMatch(new RegExp(`^${getSnapshotDir()}/macpool-`));
    expect(readFileSync(path, 'utf-8')).toBe('OLD CIPHERTEXT');
  });

  it('throws for unknown app', () => {
    vi.mocked(loadManifest).mockReturnValue({ version: 1, apps: {} } as any);
    expect(() => snapshotApp('nope')).toThrow(/No app/);
  });

  it('throws when vault file missing', () => {
    vi.mocked(loadManifest).mockReturnValue({
      version: 1,
      apps: { [APP]: { type: 'env', encryptedFile: 'missing.env.age', sourceFile: '/x', lastSealedAt: '', keyCount: 1 } as any },
    });
    expect(() => snapshotApp(APP)).toThrow(/Vault file missing/);
  });

  it('listSnapshots returns newest first', async () => {
    snapshotApp(APP);
    await new Promise(r => setTimeout(r, 5));
    snapshotApp(APP);
    const list = listSnapshots(APP);
    expect(list.length).toBeGreaterThanOrEqual(2);
    expect(list[0].timestamp >= list[1].timestamp).toBe(true);
  });

  it('restoreSnapshot writes snapshot back over vault file', () => {
    setupVault('CURRENT');
    snapshotApp(APP);
    setupVault('CHANGED');
    restoreSnapshot(APP);
    expect(readFileSync(join(FAKE_VAULT, ENC_FILE), 'utf-8')).toBe('CURRENT');
  });

  it('pruneSnapshots keeps newest N', async () => {
    for (let i = 0; i < 5; i++) {
      snapshotApp(APP);
      await new Promise(r => setTimeout(r, 5));
    }
    const before = listSnapshots(APP).length;
    expect(before).toBeGreaterThanOrEqual(5);
    expect(pruneSnapshots(APP, 2)).toBe(before - 2);
    expect(listSnapshots(APP).length).toBe(2);
  });
});
