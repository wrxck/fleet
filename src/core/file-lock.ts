import { existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

import lockfile from 'proper-lockfile';

/**
 * Inter-process lock around a state-file path. Uses proper-lockfile (the same
 * dependency the claude-cli runner uses for its mutex), which creates a
 * <path>.lock directory atomically via mkdir(2).
 *
 * The wrapped path itself does not need to exist yet — `realpath: false`
 * tells proper-lockfile to skip the realpath check, so we can lock around a
 * registry/manifest file that hasn't been written for the first time. The
 * parent directory of <path> must exist (we ensureDir below) so the .lock
 * mkdir can succeed.
 *
 * Important: this lock is NOT reentrant. Callers should wrap the outermost
 * read-modify-write boundary (e.g. a CLI command, an MCP tool handler, a
 * cron entry) and let inner helpers do plain unlocked reads/writes; the lock
 * bounds the whole RMW. Locking inside helpers that the outer caller already
 * locked will deadlock.
 */
export async function withFileLock<T>(path: string, fn: () => Promise<T> | T): Promise<T> {
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  const release = await lockfile.lock(path, {
    // Inter-process contention is normally microseconds (one process writes,
    // releases). Retry up to ~5s of backoff so a slow disk / paused process
    // doesn't immediately error out the second caller.
    retries: { retries: 5, factor: 1.5, minTimeout: 50, maxTimeout: 500 },
    // If a process crashes mid-lock, the .lock dir's mtime stops being
    // refreshed. Anyone waiting longer than `stale` ms treats the lock as
    // abandoned and steals it. 30s is generous for the kinds of operations
    // that touch the registry/manifest (a write is < 100ms typically).
    stale: 30_000,
    // Allow locking paths that don't exist on disk yet (first-write case).
    realpath: false,
  });

  try {
    return await fn();
  } finally {
    await release();
  }
}
