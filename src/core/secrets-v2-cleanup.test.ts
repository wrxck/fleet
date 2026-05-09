import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { cleanupV2Backups } from './secrets-v2-cleanup.js';

let TMP: string;

beforeEach(() => {
  TMP = mkdtempSync(join(tmpdir(), 'fleet-v2-cleanup-'));
  vi.resetModules();
  vi.resetAllMocks();
});

afterEach(() => {
  rmSync(TMP, { recursive: true, force: true });
  vi.restoreAllMocks();
});

/** build a minimal temp-dir-backed registry + manifest + snapshot tree. */
function fixture(opts: {
  mode?: 'socket' | 'unseal';
  hasBak?: boolean;
  snapTimestamps?: string[];
  app?: string;
} = {}) {
  const {
    mode = 'socket',
    hasBak = true,
    snapTimestamps = [],
    app = 'myapp',
  } = opts;

  const vaultDir = join(TMP, 'vault');
  const backupRoot = join(vaultDir, 'backups');
  const registryPath = join(TMP, 'registry.json');
  const manifestPath = join(vaultDir, 'manifest.json');

  mkdirSync(vaultDir, { recursive: true });
  mkdirSync(backupRoot, { recursive: true });

  // registry with the app entry
  writeFileSync(
    registryPath,
    JSON.stringify({
      version: 1,
      apps: [
        {
          name: app,
          displayName: app,
          composePath: join(TMP, 'app'),
          composeFile: 'docker-compose.yml',
          serviceName: app,
          domains: [],
          port: null,
          usesSharedDb: false,
          type: 'service',
          containers: [],
          dependsOnDatabases: false,
          registeredAt: '2026-01-01T00:00:00.000Z',
        },
      ],
      infrastructure: {
        databases: { serviceName: 'databases', composePath: '/noop' },
        nginx: { configPath: '/noop' },
      },
    }, null, 2),
  );

  // manifest with optional mode
  writeFileSync(
    manifestPath,
    JSON.stringify({
      version: 1,
      apps: {
        [app]: {
          type: 'env',
          encryptedFile: `${app}.env.age`,
          sourceFile: `/apps/${app}/.env`,
          lastSealedAt: '2026-01-01T00:00:00.000Z',
          keyCount: 2,
          ...(mode ? { mode } : {}),
        },
      },
    }, null, 2),
  );

  // v1 bak file
  if (hasBak) {
    writeFileSync(join(vaultDir, `${app}.env.age.v1.bak`), 'BAK-CONTENT');
  }

  // create snapshot dirs with given timestamps
  for (const ts of snapTimestamps) {
    mkdirSync(join(backupRoot, ts, app), { recursive: true });
  }

  // point env vars so the module under test reads our temp dirs
  process.env.FLEET_REGISTRY_PATH = registryPath;
  process.env.FLEET_VAULT_DIR = vaultDir;

  return { vaultDir, backupRoot, registryPath, manifestPath, app };
}

// ------------------------------------------------------------------ helpers
function daysAgo(n: number): string {
  const d = new Date(Date.now() - n * 86_400_000);
  return d.toISOString().replace(/[:.]/g, '-');
}

// ------------------------------------------------------------------ tests

describe('cleanupV2Backups', () => {
  it('happy path: removes old snapshot and v1.bak, keeps recent ones', async () => {
    const { vaultDir, backupRoot, app } = fixture({
      snapTimestamps: [daysAgo(60), daysAgo(29), daysAgo(1)],
    });

    const result = await cleanupV2Backups({ app });

    expect(result.app).toBe(app);
    expect(result.dryRun).toBeFalsy();
    expect(result.removedBak).toBeTruthy();
    expect(result.removedSnapshots).toHaveLength(1);
    expect(result.keptSnapshots).toHaveLength(2);

    // old dir physically removed
    const oldTs = result.removedSnapshots[0]!;
    expect(existsSync(join(backupRoot, oldTs, app))).toBeFalsy();

    // recent dirs still present
    for (const ts of result.keptSnapshots) {
      expect(existsSync(join(backupRoot, ts, app))).toBeTruthy();
    }

    // v1.bak removed
    expect(existsSync(join(vaultDir, `${app}.env.age.v1.bak`))).toBeFalsy();
  });

  it('dry-run: reports what would happen but does not delete anything', async () => {
    const { vaultDir, backupRoot, app } = fixture({
      snapTimestamps: [daysAgo(60), daysAgo(29), daysAgo(1)],
    });

    const result = await cleanupV2Backups({ app, dryRun: true });

    expect(result.dryRun).toBeTruthy();
    expect(result.removedBak).toBeTruthy();
    expect(result.removedSnapshots).toHaveLength(1);
    expect(result.keptSnapshots).toHaveLength(2);

    // nothing actually deleted
    const oldTs = result.removedSnapshots[0]!;
    expect(existsSync(join(backupRoot, oldTs, app))).toBeTruthy();
    expect(existsSync(join(vaultDir, `${app}.env.age.v1.bak`))).toBeTruthy();
  });

  it('custom retention: borderline snapshot (29 days ago) removed with retentionDays=7', async () => {
    const { app } = fixture({
      snapTimestamps: [daysAgo(60), daysAgo(29), daysAgo(1)],
    });

    const result = await cleanupV2Backups({ app, retentionDays: 7 });

    // both 60-days and 29-days should be removed
    expect(result.removedSnapshots).toHaveLength(2);
    expect(result.keptSnapshots).toHaveLength(1);
  });

  it('no v1.bak file: runs fine and reports removedBak=false', async () => {
    const { app } = fixture({
      hasBak: false,
      snapTimestamps: [daysAgo(1)],
    });

    const result = await cleanupV2Backups({ app });

    expect(result.removedBak).toBeFalsy();
    expect(result.keptSnapshots).toHaveLength(1);
  });

  it('throws if app not in registry', async () => {
    fixture(); // sets env vars but we ask for a different app name
    await expect(cleanupV2Backups({ app: 'ghost-app' })).rejects.toThrow('not found in fleet registry');
  });

  it('throws if app mode is not socket', async () => {
    const { app } = fixture({ mode: 'unseal' });
    await expect(cleanupV2Backups({ app })).rejects.toThrow('not in v2 mode');
  });

  it('keeps snapshot with unparseable timestamp (does not remove it)', async () => {
    const { backupRoot, app } = fixture({
      snapTimestamps: [],
    });

    mkdirSync(join(backupRoot, 'bad-timestamp-xyz', app), { recursive: true });

    const result = await cleanupV2Backups({ app });

    expect(result.keptSnapshots).toContain('bad-timestamp-xyz');
    expect(result.removedSnapshots).toHaveLength(0);
    expect(existsSync(join(backupRoot, 'bad-timestamp-xyz', app))).toBeTruthy();
  });

  it('empty snapshot list: v1.bak still removed', async () => {
    const { vaultDir, app } = fixture({ snapTimestamps: [] });

    const result = await cleanupV2Backups({ app });

    expect(result.removedSnapshots).toHaveLength(0);
    expect(result.keptSnapshots).toHaveLength(0);
    expect(result.removedBak).toBeTruthy();
    expect(existsSync(join(vaultDir, `${app}.env.age.v1.bak`))).toBeFalsy();
  });
});
