/**
 * Self-update check and apply for fleet itself.
 *
 * fleet is installed via `npm link`-style symlink from /usr/local/bin/fleet to
 * /home/matt/fleet/dist/index.js. Updates are produced by:
 *   1. git pull --ff-only origin develop  in /home/matt/fleet
 *   2. npm run build  (rewrites dist/)
 *
 * checkForUpdate() does a non-blocking `git fetch` + compares HEAD with the
 * remote. applyUpdate() runs the pull + build. Both are pure shell wrappers
 * around execSafe — easy to mock in tests, easy to reason about under sudo.
 */

import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSafe } from './exec.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
// dist/core/self-update.js → repo root is two ../
const FLEET_REPO = process.env.FLEET_REPO_PATH ?? `${__dirname}/../..`;

export interface UpdateInfo {
  /** True if `git rev-parse @{u}` shows commits ahead of HEAD. */
  available: boolean;
  /** Number of commits HEAD is behind origin. 0 if up-to-date. */
  behind: number;
  /** Short subject of the latest remote commit (or empty string on failure). */
  latestSubject: string;
  /** Branch name in the local repo. */
  branch: string;
  /** Why the check failed, if it did. */
  error?: string;
}

export interface UpdateResult {
  ok: boolean;
  pulled: number;
  buildOk: boolean;
  output: string;
}

/**
 * Non-blocking check. Does a `git fetch` (timeboxed) then compares.
 * Returns a stable UpdateInfo even on failure (just `available=false`).
 */
export async function checkForUpdate(): Promise<UpdateInfo> {
  const branchR = execSafe('git', ['-C', FLEET_REPO, 'rev-parse', '--abbrev-ref', 'HEAD']);
  if (!branchR.ok) {
    return { available: false, behind: 0, latestSubject: '', branch: '?', error: branchR.stderr };
  }
  const branch = branchR.stdout;

  // Fetch quietly, with a short timeout so we never block the TUI launch.
  const fetchR = execSafe('git', ['-C', FLEET_REPO, 'fetch', '--quiet', 'origin', branch], { timeout: 8_000 });
  if (!fetchR.ok) {
    return { available: false, behind: 0, latestSubject: '', branch, error: 'fetch failed' };
  }

  const countR = execSafe('git', ['-C', FLEET_REPO, 'rev-list', '--count', `HEAD..origin/${branch}`]);
  if (!countR.ok) {
    return { available: false, behind: 0, latestSubject: '', branch, error: countR.stderr };
  }
  const behind = parseInt(countR.stdout, 10) || 0;

  let latestSubject = '';
  if (behind > 0) {
    const subR = execSafe('git', ['-C', FLEET_REPO, 'log', '-1', '--pretty=%s', `origin/${branch}`]);
    latestSubject = subR.ok ? subR.stdout : '';
  }

  return { available: behind > 0, behind, latestSubject, branch };
}

/**
 * Apply: git pull --ff-only + npm run build. Refuses to run if the working
 * tree is dirty (would clobber uncommitted changes). Returns aggregate output
 * for the toast / TUI to surface.
 */
export async function applyUpdate(): Promise<UpdateResult> {
  const dirty = execSafe('git', ['-C', FLEET_REPO, 'status', '--porcelain']);
  if (dirty.ok && dirty.stdout.length > 0) {
    return {
      ok: false, pulled: 0, buildOk: false,
      output: 'Refusing to update: working tree is dirty. Commit or stash first.',
    };
  }

  const pre = execSafe('git', ['-C', FLEET_REPO, 'rev-parse', 'HEAD']);
  const pull = execSafe('git', ['-C', FLEET_REPO, 'pull', '--ff-only'], { timeout: 30_000 });
  if (!pull.ok) {
    return { ok: false, pulled: 0, buildOk: false, output: pull.stderr || pull.stdout };
  }
  const post = execSafe('git', ['-C', FLEET_REPO, 'rev-parse', 'HEAD']);
  const pulled = pre.stdout !== post.stdout ? 1 : 0;  // 1 = something updated

  const build = execSafe('npm', ['run', 'build'], { cwd: FLEET_REPO, timeout: 120_000 });
  return {
    ok: pull.ok && build.ok,
    pulled,
    buildOk: build.ok,
    output: pulled === 0 ? 'Already up to date.' : (build.ok ? 'Updated + rebuilt.' : build.stderr),
  };
}
