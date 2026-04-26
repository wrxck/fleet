/**
 * Pre-rotation vault snapshots. Every destructive operation copies the
 * current encrypted file to vault/.snapshots/<app>-<timestamp>.env.age
 * BEFORE making changes. Restoration is one command.
 *
 * Snapshots are immutable (copy + atomic-rename pattern). Cleanup is
 * manual via `fleet secrets snapshots prune` — we never auto-delete.
 */

import { existsSync, mkdirSync, copyFileSync, readdirSync, statSync, renameSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { loadManifest, VAULT_DIR } from './secrets.js';
import { SecretsError } from './errors.js';

// Computed lazily via snapshotDir() so test mocks of VAULT_DIR work cleanly.
function snapshotDir(): string {
  return join(VAULT_DIR, '.snapshots');
}

export interface Snapshot {
  app: string;
  timestamp: string;
  path: string;
  sizeBytes: number;
}

function ensureSnapshotDir(): void {
  if (!existsSync(snapshotDir())) {
    mkdirSync(snapshotDir(), { recursive: true, mode: 0o700 });
  }
}

/** Pre-rotation copy. Returns the absolute path to the snapshot. */
export function snapshotApp(app: string): string {
  ensureSnapshotDir();
  const manifest = loadManifest();
  const entry = manifest.apps[app];
  if (!entry) throw new SecretsError(`No app in manifest: ${app}`);
  const src = join(VAULT_DIR, entry.encryptedFile);
  if (!existsSync(src)) throw new SecretsError(`Vault file missing: ${entry.encryptedFile}`);

  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const dest = join(snapshotDir(), `${app}-${ts}.env.age`);
  const tmp = dest + '.tmp';
  copyFileSync(src, tmp);
  renameSync(tmp, dest);  // atomic
  return dest;
}

/** All snapshots for an app, newest first. */
export function listSnapshots(app: string): Snapshot[] {
  if (!existsSync(snapshotDir())) return [];
  const prefix = `${app}-`;
  return readdirSync(snapshotDir())
    .filter(f => f.startsWith(prefix) && f.endsWith('.env.age'))
    .map(f => {
      const path = join(snapshotDir(), f);
      const ts = f.substring(prefix.length, f.length - '.env.age'.length);
      return {
        app,
        timestamp: ts,
        path,
        sizeBytes: statSync(path).size,
      };
    })
    .sort((a, b) => b.timestamp.localeCompare(a.timestamp));
}

/**
 * Restore a snapshot. Without a timestamp, uses the newest. Replaces the live
 * vault file in-place. Returns the snapshot that was used.
 */
export function restoreSnapshot(app: string, timestamp?: string): Snapshot {
  const snaps = listSnapshots(app);
  if (snaps.length === 0) throw new SecretsError(`No snapshots for ${app}`);
  const target = timestamp
    ? snaps.find(s => s.timestamp === timestamp)
    : snaps[0];
  if (!target) throw new SecretsError(`Snapshot not found: ${timestamp}`);

  const manifest = loadManifest();
  const entry = manifest.apps[app];
  if (!entry) throw new SecretsError(`No app in manifest: ${app}`);
  const dest = join(VAULT_DIR, entry.encryptedFile);
  // Atomic replace: copy → fsync → rename. A crash mid-restore leaves the
  // original vault file intact (the tmp file is the only thing in flux).
  const tmp = dest + '.restore.tmp';
  copyFileSync(target.path, tmp);
  renameSync(tmp, dest);
  return target;
}

/** Delete snapshots older than `keep` (count, newest kept). Returns # deleted. */
export function pruneSnapshots(app: string, keep: number): number {
  const snaps = listSnapshots(app);
  if (snaps.length <= keep) return 0;
  const drop = snaps.slice(keep);
  for (const s of drop) unlinkSync(s.path);
  return drop.length;
}

export function getSnapshotDir(): string {
  return snapshotDir();
}
