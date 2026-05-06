import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { basename, join } from 'node:path';

export interface SnapshotInput {
  app: string;
  backupRoot: string;       // e.g. /home/matt/fleet/vault/backups
  vaultDir: string;          // dir holding <encryptedFile>
  encryptedFile: string;     // e.g. 'a.env.age'
  composeDir: string;        // dir holding <composeFile>
  composeFile: string;       // e.g. 'docker-compose.yml'
  appUnitFile: string;       // absolute path to /etc/systemd/system/<app>.service
}

export interface Snapshot {
  app: string;
  timestamp: string;         // safe filename form, e.g. '2026-05-06T21-50-12-345Z'
  dir: string;               // backupRoot + '/' + timestamp + '/' + app
  manifestEntry: unknown;    // the manifest entry at snapshot time (object, not JSON string)
}

function makeTimestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

/**
 * capture a timestamped backup of all four artefacts for an app:
 *  - encrypted vault blob
 *  - manifest entry (as manifest.json in the snapshot dir)
 *  - compose file
 *  - systemd unit (if it exists)
 */
export function snapshotApp(input: SnapshotInput): Snapshot {
  const { app, backupRoot, vaultDir, encryptedFile, composeDir, composeFile, appUnitFile } = input;

  const timestamp = makeTimestamp();
  const snapDir = join(backupRoot, timestamp, app);
  mkdirSync(snapDir, { recursive: true, mode: 0o700 });

  // 1. encrypted vault blob
  copyFileSync(join(vaultDir, encryptedFile), join(snapDir, encryptedFile));

  // 2. manifest entry for this app only
  const manifestPath = join(vaultDir, 'manifest.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8')) as {
    version: number;
    apps: Record<string, unknown>;
  };
  const manifestEntry = manifest.apps[app] ?? {};
  writeFileSync(join(snapDir, 'manifest.json'), JSON.stringify(manifestEntry, null, 2));

  // 3. compose file
  copyFileSync(join(composeDir, composeFile), join(snapDir, composeFile));

  // 4. systemd unit (omitted if it doesn't exist yet)
  if (existsSync(appUnitFile)) {
    copyFileSync(appUnitFile, join(snapDir, basename(appUnitFile)));
  }

  return { app, timestamp, dir: snapDir, manifestEntry };
}

/**
 * restore all four artefacts from a snapshot back to their original locations.
 * the manifest is merged: only apps[app] is replaced, other apps are untouched.
 * if the unit file wasn't captured (didn't exist at snapshot time), no unit is written.
 */
export function restoreSnapshot(input: SnapshotInput, snap: Snapshot): void {
  const { app, vaultDir, encryptedFile, composeDir, composeFile, appUnitFile } = input;
  const { dir: snapDir } = snap;

  // 1. encrypted vault blob
  copyFileSync(join(snapDir, encryptedFile), join(vaultDir, encryptedFile));

  // 2. manifest entry — merge back into live manifest, leaving other apps untouched
  const snapEntryRaw = readFileSync(join(snapDir, 'manifest.json'), 'utf-8');
  const snapEntry = JSON.parse(snapEntryRaw) as unknown;

  const manifestPath = join(vaultDir, 'manifest.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8')) as {
    version: number;
    apps: Record<string, unknown>;
  };
  manifest.apps[app] = snapEntry;
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

  // 3. compose file
  copyFileSync(join(snapDir, composeFile), join(composeDir, composeFile));

  // 4. systemd unit — only write back if it was captured in the snapshot
  const unitBasename = basename(appUnitFile);
  const snapUnit = join(snapDir, unitBasename);
  if (existsSync(snapUnit)) {
    copyFileSync(snapUnit, appUnitFile);
  }
}

/**
 * walk backupRoot looking for <timestamp>/<app>/ directories.
 * returns snapshots sorted newest-first by timestamp string (lexicographic, which
 * works correctly for the ISO-safe format with dashes instead of colons/dots).
 * returns [] if backupRoot doesn't exist.
 */
export function listSnapshots(backupRoot: string, app: string): Snapshot[] {
  if (!existsSync(backupRoot)) return [];

  const results: Snapshot[] = [];

  for (const entry of readdirSync(backupRoot)) {
    const tsDir = join(backupRoot, entry);
    try {
      if (!statSync(tsDir).isDirectory()) continue;
    } catch {
      continue;
    }

    const appDir = join(tsDir, app);
    try {
      if (!statSync(appDir).isDirectory()) continue;
    } catch {
      continue;
    }

    results.push({
      app,
      timestamp: entry,
      dir: appDir,
      manifestEntry: {},
    });
  }

  // Sort newest-first — the timestamp format is lexicographically sortable
  results.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  return results;
}
