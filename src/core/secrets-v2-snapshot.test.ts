import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { snapshotApp, restoreSnapshot, listSnapshots, type SnapshotInput } from './secrets-v2-snapshot';

let TMP: string;

beforeEach(() => {
  TMP = mkdtempSync(join(tmpdir(), 'fleet-v2-snap-'));
  vi.resetModules();
});

afterEach(() => {
  rmSync(TMP, { recursive: true, force: true });
});

function fixture() {
  const vaultDir = join(TMP, 'vault');
  const composeDir = join(TMP, 'app');
  const unitDir = join(TMP, 'units');
  const backupRoot = join(TMP, 'backups');
  mkdirSync(vaultDir, { recursive: true });
  mkdirSync(composeDir, { recursive: true });
  mkdirSync(unitDir, { recursive: true });

  writeFileSync(join(vaultDir, 'a.env.age'), 'CIPHERTEXT-V1');
  writeFileSync(
    join(vaultDir, 'manifest.json'),
    JSON.stringify({
      version: 1,
      apps: {
        a: {
          type: 'env',
          encryptedFile: 'a.env.age',
          sourceFile: '/apps/a/.env',
          lastSealedAt: '2026-01-01T00:00:00.000Z',
          keyCount: 2,
        },
      },
    }, null, 2),
  );
  writeFileSync(join(composeDir, 'docker-compose.yml'), 'services:\n  a:\n    env_file: /run/fleet-secrets/a/.env\n');
  const unitFile = join(unitDir, 'a.service');
  writeFileSync(unitFile, '[Unit]\nDescription=a\n[Service]\nExecStart=/bin/true\n');

  const input: SnapshotInput = {
    app: 'a',
    backupRoot,
    vaultDir,
    encryptedFile: 'a.env.age',
    composeDir,
    composeFile: 'docker-compose.yml',
    appUnitFile: unitFile,
  };
  return { input, vaultDir, composeDir, unitFile, backupRoot };
}

describe('snapshotApp', () => {
  it('writes vault blob, manifest entry, compose, and app unit into backup dir', () => {
    const { input } = fixture();
    const snap = snapshotApp(input);

    expect(snap.app).toBe('a');
    expect(snap.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(snap.dir.startsWith(input.backupRoot)).toBe(true);

    expect(existsSync(join(snap.dir, 'a.env.age'))).toBe(true);
    expect(readFileSync(join(snap.dir, 'a.env.age'), 'utf-8')).toBe('CIPHERTEXT-V1');
    expect(existsSync(join(snap.dir, 'manifest.json'))).toBe(true);
    expect(existsSync(join(snap.dir, 'docker-compose.yml'))).toBe(true);
    expect(existsSync(join(snap.dir, 'a.service'))).toBe(true);

    const savedEntry = JSON.parse(readFileSync(join(snap.dir, 'manifest.json'), 'utf-8'));
    expect(savedEntry.encryptedFile).toBe('a.env.age');
    expect(savedEntry.keyCount).toBe(2);
  });

  it('omits app unit if file does not exist', () => {
    const { input } = fixture();
    const noUnitInput = { ...input, appUnitFile: join(TMP, 'never-existed.service') };
    const snap = snapshotApp(noUnitInput);
    expect(existsSync(join(snap.dir, 'never-existed.service'))).toBe(false);
    // other three artefacts still present
    expect(existsSync(join(snap.dir, 'a.env.age'))).toBe(true);
    expect(existsSync(join(snap.dir, 'manifest.json'))).toBe(true);
    expect(existsSync(join(snap.dir, 'docker-compose.yml'))).toBe(true);
  });
});

describe('restoreSnapshot', () => {
  it('round-trips: snapshot, mutate all four artefacts, restore, all match originals', () => {
    const { input, vaultDir, composeDir, unitFile } = fixture();

    const snap = snapshotApp(input);

    // mutate everything
    writeFileSync(join(vaultDir, 'a.env.age'), 'CIPHERTEXT-V2');
    writeFileSync(
      join(vaultDir, 'manifest.json'),
      JSON.stringify({ version: 1, apps: { a: { type: 'env', encryptedFile: 'a.env.age', sourceFile: '/changed', lastSealedAt: '2026-02-01T00:00:00.000Z', keyCount: 99 } } }, null, 2),
    );
    writeFileSync(join(composeDir, 'docker-compose.yml'), 'CHANGED');
    writeFileSync(unitFile, 'CHANGED-UNIT');

    restoreSnapshot(input, snap);

    expect(readFileSync(join(vaultDir, 'a.env.age'), 'utf-8')).toBe('CIPHERTEXT-V1');
    const restoredManifest = JSON.parse(readFileSync(join(vaultDir, 'manifest.json'), 'utf-8'));
    expect(restoredManifest.apps.a.keyCount).toBe(2);
    expect(restoredManifest.apps.a.sourceFile).toBe('/apps/a/.env');
    expect(readFileSync(join(composeDir, 'docker-compose.yml'), 'utf-8')).toContain('env_file');
    expect(readFileSync(unitFile, 'utf-8')).toContain('Description=a');
  });

  it('does not touch live unit file when snapshot was taken without one', () => {
    const { input, unitFile } = fixture();
    const noUnitInput = { ...input, appUnitFile: join(TMP, 'never-existed.service') };
    const snap = snapshotApp(noUnitInput);

    // write a "live" unit file at the original location after the snapshot
    writeFileSync(unitFile, 'NEW-UNIT-WRITTEN-AFTER-SNAPSHOT');

    // restoring the no-unit snapshot must not delete or change the live unit
    restoreSnapshot(noUnitInput, snap);
    expect(readFileSync(unitFile, 'utf-8')).toBe('NEW-UNIT-WRITTEN-AFTER-SNAPSHOT');
  });
});

describe('listSnapshots', () => {
  it('returns empty array when backup root does not exist', () => {
    expect(listSnapshots(join(TMP, 'no-such-dir'), 'a')).toEqual([]);
  });

  it('returns snapshots sorted newest first', () => {
    const { input } = fixture();

    // create three with synthetic timestamps by directly making dirs
    mkdirSync(join(input.backupRoot, '2026-05-01T00-00-00-000Z', 'a'), { recursive: true });
    mkdirSync(join(input.backupRoot, '2026-05-03T00-00-00-000Z', 'a'), { recursive: true });
    mkdirSync(join(input.backupRoot, '2026-05-02T00-00-00-000Z', 'a'), { recursive: true });

    const snaps = listSnapshots(input.backupRoot, 'a');
    expect(snaps.map(s => s.timestamp)).toEqual([
      '2026-05-03T00-00-00-000Z',
      '2026-05-02T00-00-00-000Z',
      '2026-05-01T00-00-00-000Z',
    ]);
  });

  it('skips timestamps that lack a per-app subdir', () => {
    const { input } = fixture();

    mkdirSync(join(input.backupRoot, '2026-05-04T00-00-00-000Z', 'b'), { recursive: true });
    mkdirSync(join(input.backupRoot, '2026-05-05T00-00-00-000Z', 'a'), { recursive: true });

    const snaps = listSnapshots(input.backupRoot, 'a');
    expect(snaps.map(s => s.timestamp)).toEqual(['2026-05-05T00-00-00-000Z']);
  });
});
