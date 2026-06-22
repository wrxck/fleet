/**
 * Self-update check and apply for fleet itself.
 *
 * fleet is installed via `npm link`-style symlink from /usr/local/bin/fleet to
 * the repo's dist/index.js. Updates are produced by:
 *   1. git fetch origin <channel>  (channel = main by default, develop on opt-in)
 *   2. git pull --ff-only origin <channel>  in the fleet checkout
 *   3. npm run build  (rewrites dist/)
 *
 * Channel selection:
 *   - default: 'stable' → tracks origin/main (tagged releases only).
 *   - FLEET_UPDATE_CHANNEL=prerelease → tracks origin/develop (work in flight).
 *   - FLEET_UPDATE_BRANCH=<name> → arbitrary branch (escape hatch for forks).
 *
 * The check intentionally compares against the configured remote branch, not
 * the local HEAD's tracking branch — so even if the local checkout is on
 * `develop` the operator can opt back to the stable channel without first
 * switching branches.
 *
 * checkForUpdate() does a non-blocking `git fetch` + compares HEAD with the
 * remote. applyUpdate() runs the pull + build. Both are pure shell wrappers
 * around execSafe — easy to mock in tests, easy to reason about under sudo.
 *
 * Supply-chain hardening (opt-in):
 *   - FLEET_UPDATE_VERIFY=1 → require a trusted signature on the pulled HEAD
 *     before running `npm run build`; an unverified pull is rolled back.
 *   - FLEET_UPDATE_ALLOWED_SIGNERS=<path> → SSH allowed-signers file used for
 *     verification, scoped to the one verify-commit invocation.
 */

import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { execSafe } from './exec';

const __dirname = dirname(fileURLToPath(import.meta.url));
// dist/core/self-update.js → repo root is two ../
const FLEET_REPO = process.env.FLEET_REPO_PATH ?? `${__dirname}/../..`;

export type UpdateChannel = 'stable' | 'prerelease';

/** resolve the remote branch to track based on env vars. */
export function resolveChannel(): { channel: UpdateChannel; branch: string } {
  // explicit branch override wins — for forks or custom workflows.
  const explicit = process.env.FLEET_UPDATE_BRANCH;
  if (explicit) {
    const channel: UpdateChannel = explicit === 'develop' ? 'prerelease' : 'stable';
    return { channel, branch: explicit };
  }
  if (process.env.FLEET_UPDATE_CHANNEL === 'prerelease') {
    return { channel: 'prerelease', branch: 'develop' };
  }
  return { channel: 'stable', branch: 'main' };
}

export interface UpdateInfo {
  /** true if `git rev-parse @{u}` shows commits ahead of HEAD. */
  available: boolean;
  /** number of commits HEAD is behind the configured remote branch. */
  behind: number;
  /** short subject of the latest remote commit (or empty string on failure). */
  latestSubject: string;
  /** local branch in the working tree. */
  branch: string;
  /** remote branch being tracked for updates (e.g. 'main' or 'develop'). */
  remoteBranch: string;
  /** stable = main (tagged releases), prerelease = develop (work in flight). */
  channel: UpdateChannel;
  /** why the check failed, if it did. */
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
  const { channel, branch: remoteBranch } = resolveChannel();

  const branchR = execSafe('git', ['-C', FLEET_REPO, 'rev-parse', '--abbrev-ref', 'HEAD']);
  if (!branchR.ok) {
    return {
      available: false, behind: 0, latestSubject: '',
      branch: '?', remoteBranch, channel,
      error: branchR.stderr,
    };
  }
  const branch = branchR.stdout;

  // Fetch quietly, with a short timeout so we never block the TUI launch.
  const fetchR = execSafe(
    'git',
    ['-C', FLEET_REPO, 'fetch', '--quiet', 'origin', remoteBranch],
    { timeout: 8_000 },
  );
  if (!fetchR.ok) {
    return {
      available: false, behind: 0, latestSubject: '',
      branch, remoteBranch, channel,
      error: 'fetch failed',
    };
  }

  const countR = execSafe(
    'git', ['-C', FLEET_REPO, 'rev-list', '--count', `HEAD..origin/${remoteBranch}`],
  );
  if (!countR.ok) {
    return {
      available: false, behind: 0, latestSubject: '',
      branch, remoteBranch, channel,
      error: countR.stderr,
    };
  }
  const behind = parseInt(countR.stdout, 10) || 0;

  let latestSubject = '';
  if (behind > 0) {
    const subR = execSafe(
      'git', ['-C', FLEET_REPO, 'log', '-1', '--pretty=%s', `origin/${remoteBranch}`],
    );
    latestSubject = subR.ok ? subR.stdout : '';
  }

  return { available: behind > 0, behind, latestSubject, branch, remoteBranch, channel };
}

/**
 * Whether signature verification of pulled commits is required before building.
 * Off by default (most installs have no maintainer key imported, and forcing it
 * unconditionally would brick self-update). When the operator opts in, a pull
 * that lands an unverified commit is rolled back and the build never runs.
 */
export function verificationEnabled(): boolean {
  const v = (process.env.FLEET_UPDATE_VERIFY ?? '').toLowerCase();
  return v === '1' || v === 'true' || v === 'yes';
}

/**
 * Verify a revision's signature with git. When an allowed-signers file is
 * configured (SSH signing) it is passed scoped to this one command so we do
 * not mutate global git config. Returns ok=false (never throws) so the caller
 * can fail closed. `runner` is injectable for tests.
 */
export function verifyRevision(
  rev: string,
  runner: typeof execSafe = execSafe,
): { ok: boolean; output: string } {
  const signers = process.env.FLEET_UPDATE_ALLOWED_SIGNERS;
  const cfg = signers ? ['-c', `gpg.ssh.allowedSignersFile=${signers}`] : [];
  const r = runner('git', ['-C', FLEET_REPO, ...cfg, 'verify-commit', '--raw', rev], { timeout: 15_000 });
  return { ok: r.ok, output: r.stderr || r.stdout };
}

/**
 * Apply: git pull --ff-only origin <channel-branch> + npm run build. Refuses
 * to run if the working tree is dirty (would clobber uncommitted changes).
 *
 * Supply-chain hardening: when FLEET_UPDATE_VERIFY is enabled, the freshly
 * pulled HEAD must carry a trusted signature before we run `npm run build`
 * (the build script comes from the pulled tree and runs with fleet's
 * privileges, so an unverified pull is an RCE primitive). On a failed
 * verification we hard-reset back to the pre-pull commit and refuse to build.
 *
 * Returns aggregate output for the toast / TUI to surface.
 */
export async function applyUpdate(): Promise<UpdateResult> {
  const { branch: remoteBranch } = resolveChannel();

  const dirty = execSafe('git', ['-C', FLEET_REPO, 'status', '--porcelain']);
  if (dirty.ok && dirty.stdout.length > 0) {
    return {
      ok: false, pulled: 0, buildOk: false,
      output: 'Refusing to update: working tree is dirty. Commit or stash first.',
    };
  }

  const pre = execSafe('git', ['-C', FLEET_REPO, 'rev-parse', 'HEAD']);
  const pull = execSafe(
    'git', ['-C', FLEET_REPO, 'pull', '--ff-only', 'origin', remoteBranch],
    { timeout: 30_000 },
  );
  if (!pull.ok) {
    return { ok: false, pulled: 0, buildOk: false, output: pull.stderr || pull.stdout };
  }
  const post = execSafe('git', ['-C', FLEET_REPO, 'rev-parse', 'HEAD']);
  const pulled = pre.stdout !== post.stdout ? 1 : 0;  // 1 = something updated

  // Only meaningful when HEAD actually moved. Verify BEFORE building so an
  // untrusted commit's build script never executes.
  if (pulled === 1 && verificationEnabled()) {
    const verdict = verifyRevision(post.stdout);
    if (!verdict.ok) {
      // roll the working tree back to the trusted commit we started from.
      execSafe('git', ['-C', FLEET_REPO, 'reset', '--hard', pre.stdout], { timeout: 15_000 });
      return {
        ok: false,
        pulled: 0,
        buildOk: false,
        output:
          `Refusing to build: pulled commit ${post.stdout.slice(0, 12)} failed signature ` +
          `verification — rolled back to ${pre.stdout.slice(0, 12)}. ${verdict.output}`.trim(),
      };
    }
  }

  const build = execSafe('npm', ['run', 'build'], { cwd: FLEET_REPO, timeout: 120_000 });
  return {
    ok: pull.ok && build.ok,
    pulled,
    buildOk: build.ok,
    output: pulled === 0 ? 'Already up to date.' : (build.ok ? 'Updated + rebuilt.' : build.stderr),
  };
}
