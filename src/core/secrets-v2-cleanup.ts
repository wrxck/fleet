import { dirname, join } from 'node:path';
import { existsSync, readdirSync, rmSync, unlinkSync } from 'node:fs';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { findApp, load } from './registry';
import { listSnapshots } from './secrets-v2-snapshot';
import { SecretsError } from './errors';
import type { Manifest } from './secrets';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** resolve vault dir: env override (used in tests) or the default computed path */
function resolveVaultDir(): string {
  return process.env.FLEET_VAULT_DIR ?? join(__dirname, '..', '..', 'vault');
}

/** read manifest directly without calling requireInit() */
function readManifest(vaultDir: string): Manifest {
  const p = join(vaultDir, 'manifest.json');
  if (!existsSync(p)) return { version: 1, apps: {} };
  try {
    return JSON.parse(readFileSync(p, 'utf-8')) as Manifest;
  } catch {
    return { version: 1, apps: {} };
  }
}

export interface CleanupOpts {
  app: string;
  retentionDays?: number;
  dryRun?: boolean;
}

export interface CleanupResult {
  app: string;
  removedBak: boolean;
  removedSnapshots: string[];
  keptSnapshots: string[];
  dryRun: boolean;
}

/**
 * parse a filesystem-safe snapshot timestamp back to a Date.
 * input: '2026-05-06T12-00-00-000Z' (colons and dots replaced with dashes)
 * output: Date('2026-05-06T12:00:00.000Z'), or null if unparseable
 */
export function parseSnapshotTimestamp(ts: string): Date | null {
  const m = ts.match(/^(\d{4}-\d{2}-\d{2}T)(\d{2})-(\d{2})-(\d{2})-(\d{3})Z$/);
  if (!m) return null;
  return new Date(`${m[1]}${m[2]}:${m[3]}:${m[4]}.${m[5]}Z`);
}

export async function cleanupV2Backups(opts: CleanupOpts): Promise<CleanupResult> {
  const { app, retentionDays = 30, dryRun = false } = opts;

  const registry = load();
  const appEntry = findApp(registry, app);
  if (!appEntry) {
    throw new SecretsError(`app '${app}' not found in fleet registry`);
  }

  const vaultDir = resolveVaultDir();
  const manifest = readManifest(vaultDir);
  const entry = manifest.apps[app];
  if (!entry || entry.mode !== 'socket') {
    throw new SecretsError(
      `app '${app}' is not in v2 mode; cleanup is for post-v2-migration apps only`,
    );
  }

  const cutoff = Date.now() - retentionDays * 86_400_000;
  const backupRoot = join(vaultDir, 'backups');
  const snapshots = listSnapshots(backupRoot, app);

  const removedSnapshots: string[] = [];
  const keptSnapshots: string[] = [];

  for (const snap of snapshots) {
    const ts = parseSnapshotTimestamp(snap.timestamp);
    if (!ts) {
      // unparseable timestamp — keep rather than risk destroying unknown content
      keptSnapshots.push(snap.timestamp);
      continue;
    }
    if (ts.getTime() < cutoff) {
      removedSnapshots.push(snap.timestamp);
      if (!dryRun) {
        rmSync(snap.dir, { recursive: true, force: true });
        // best-effort: remove the parent timestamp dir if it's now empty
        const parentDir = dirname(snap.dir);
        try {
          const remaining = readdirSync(parentDir);
          if (remaining.length === 0) rmSync(parentDir, { recursive: true, force: true });
        } catch { /* ignore */ }
      }
    } else {
      keptSnapshots.push(snap.timestamp);
    }
  }

  let removedBak = false;
  const bakPath = join(vaultDir, `${app}.env.age.v1.bak`);
  if (existsSync(bakPath)) {
    if (!dryRun) {
      try {
        unlinkSync(bakPath);
        removedBak = true;
      } catch { /* best-effort */ }
    } else {
      removedBak = true;
    }
  }

  return { app, removedBak, removedSnapshots, keptSnapshots, dryRun };
}
