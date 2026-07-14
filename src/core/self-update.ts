/**
 * Self-update check and apply for fleet itself.
 *
 * Two install kinds are supported, detected per invocation:
 *
 * git checkout (dev boxes, `npm link`-style symlink to the repo's dist):
 *   1. git fetch origin <channel>  (channel = main by default, develop on opt-in)
 *   2. git pull --ff-only origin <channel>  in the fleet checkout
 *   3. npm run build  (rewrites dist/)
 *
 * global npm install (servers, `npm i -g @matthesketh/fleet`): the package
 * root has no git metadata, so updates go through the npm registry instead —
 * check compares the installed package.json version against the published
 * `latest` dist-tag, apply runs `npm install -g` (the tarball ships a prebuilt
 * dist/, so there is no local build step). Channel/branch overrides need the
 * git history and are refused in npm mode. An install that is neither kind is
 * refused rather than guessed at.
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

import { existsSync, readFileSync } from 'node:fs';
import { dirname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { execSafe } from './exec';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** the npm package this distribution publishes as — the npm-mode update target. */
const PACKAGE_NAME = '@matthesketh/fleet';

// dist/core/self-update.js → package/repo root is two ../. read per call so a
// FLEET_REPO_PATH set by the calling process (tests, in-process MCP) is
// honoured, matching how the channel env overrides behave.
function fleetRepo(): string {
  return process.env.FLEET_REPO_PATH ?? `${__dirname}/../..`;
}

export type UpdateChannel = 'stable' | 'prerelease';

export type InstallKind = 'git' | 'npm' | 'unknown';

/** how this fleet was installed. a git checkout updates via pull + rebuild; a
 *  global npm install updates via the registry; anything else is refused. */
export function detectInstallKind(): InstallKind {
  const root = fleetRepo();
  if (existsSync(`${root}/.git`)) return 'git';
  if (root.split(sep).includes('node_modules')) return 'npm';
  return 'unknown';
}

/** version of the running install, from its own package.json. */
function installedVersion(): string {
  try {
    const pkg = JSON.parse(readFileSync(`${fleetRepo()}/package.json`, 'utf-8')) as {
      version?: string;
    };
    return pkg.version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}

/** numeric dotted-version compare — enough for this package's plain x.y.z
 *  releases. returns >0 when a is newer, <0 when older, 0 when equal. */
export function compareVersions(a: string, b: string): number {
  const parse = (v: string) => v.replace(/^v/, '').split('.').map(p => parseInt(p, 10) || 0);
  const [pa, pb] = [parse(a), parse(b)];
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

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
  /** set for non-git installs; absent means a git checkout. */
  kind?: InstallKind;
  /** installed package version (npm mode only). */
  localVersion?: string;
  /** latest published version (npm mode only). */
  remoteVersion?: string;
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
  const kind = detectInstallKind();
  if (kind !== 'git') return checkNonGitUpdate(kind);

  const { channel, branch: remoteBranch } = resolveChannel();

  const branchR = execSafe('git', ['-C', fleetRepo(), 'rev-parse', '--abbrev-ref', 'HEAD']);
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
    ['-C', fleetRepo(), 'fetch', '--quiet', 'origin', remoteBranch],
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
    'git', ['-C', fleetRepo(), 'rev-list', '--count', `HEAD..origin/${remoteBranch}`],
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
      'git', ['-C', fleetRepo(), 'log', '-1', '--pretty=%s', `origin/${remoteBranch}`],
    );
    latestSubject = subR.ok ? subR.stdout : '';
  }

  return { available: behind > 0, behind, latestSubject, branch, remoteBranch, channel };
}

function unknownInstallError(): string {
  return (
    `fleet at ${fleetRepo()} is neither a git checkout nor an npm install; ` +
    `reinstall with: npm install -g ${PACKAGE_NAME}`
  );
}

function channelOverrideError(): string {
  return 'channel/branch overrides need a git checkout; npm installs track the latest published release';
}

/** registry-backed check for global npm installs (and refusal for unknowns). */
async function checkNonGitUpdate(kind: 'npm' | 'unknown'): Promise<UpdateInfo> {
  const local = installedVersion();
  const base = {
    behind: 0,
    latestSubject: '',
    branch: `v${local}`,
    remoteBranch: 'npm:latest',
    channel: 'stable' as const,
    kind,
    localVersion: local,
  };
  if (kind === 'unknown') {
    return { ...base, available: false, error: unknownInstallError() };
  }
  const { channel } = resolveChannel();
  if (channel !== 'stable' || process.env.FLEET_UPDATE_BRANCH) {
    return { ...base, available: false, error: channelOverrideError() };
  }
  const r = execSafe('npm', ['view', PACKAGE_NAME, 'version'], { timeout: 15_000 });
  if (!r.ok) {
    return { ...base, available: false, error: 'npm registry check failed' };
  }
  const remote = r.stdout.trim();
  const available = compareVersions(remote, local) > 0;
  return {
    ...base,
    available,
    behind: available ? 1 : 0,
    latestSubject: available ? `v${remote}` : '',
    remoteVersion: remote,
  };
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
  const r = runner('git', ['-C', fleetRepo(), ...cfg, 'verify-commit', '--raw', rev], { timeout: 15_000 });
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
  const kind = detectInstallKind();
  if (kind !== 'git') return applyNonGitUpdate(kind);

  const { branch: remoteBranch } = resolveChannel();

  const dirty = execSafe('git', ['-C', fleetRepo(), 'status', '--porcelain']);
  if (dirty.ok && dirty.stdout.length > 0) {
    return {
      ok: false, pulled: 0, buildOk: false,
      output: 'Refusing to update: working tree is dirty. Commit or stash first.',
    };
  }

  const pre = execSafe('git', ['-C', fleetRepo(), 'rev-parse', 'HEAD']);
  const pull = execSafe(
    'git', ['-C', fleetRepo(), 'pull', '--ff-only', 'origin', remoteBranch],
    { timeout: 30_000 },
  );
  if (!pull.ok) {
    return { ok: false, pulled: 0, buildOk: false, output: pull.stderr || pull.stdout };
  }
  const post = execSafe('git', ['-C', fleetRepo(), 'rev-parse', 'HEAD']);
  const pulled = pre.stdout !== post.stdout ? 1 : 0;  // 1 = something updated

  // Only meaningful when HEAD actually moved. Verify BEFORE building so an
  // untrusted commit's build script never executes.
  if (pulled === 1 && verificationEnabled()) {
    const verdict = verifyRevision(post.stdout);
    if (!verdict.ok) {
      // roll the working tree back to the trusted commit we started from.
      execSafe('git', ['-C', fleetRepo(), 'reset', '--hard', pre.stdout], { timeout: 15_000 });
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

  const build = execSafe('npm', ['run', 'build'], { cwd: fleetRepo(), timeout: 120_000 });
  return {
    ok: pull.ok && build.ok,
    pulled,
    buildOk: build.ok,
    output: pulled === 0 ? 'Already up to date.' : (build.ok ? 'Updated + rebuilt.' : build.stderr),
  };
}

/** registry-backed apply for global npm installs (and refusal for unknowns).
 *  npm handles fetch, integrity and bin links; the published tarball ships a
 *  prebuilt dist/ so no local build step runs, hence buildOk=true on success. */
async function applyNonGitUpdate(kind: 'npm' | 'unknown'): Promise<UpdateResult> {
  if (kind === 'unknown') {
    return { ok: false, pulled: 0, buildOk: false, output: unknownInstallError() };
  }
  const { channel } = resolveChannel();
  if (channel !== 'stable' || process.env.FLEET_UPDATE_BRANCH) {
    return { ok: false, pulled: 0, buildOk: false, output: channelOverrideError() };
  }
  const before = installedVersion();
  const r = execSafe('npm', ['install', '-g', `${PACKAGE_NAME}@latest`], { timeout: 300_000 });
  if (!r.ok) {
    return { ok: false, pulled: 0, buildOk: false, output: r.stderr || r.stdout };
  }
  // npm -g replaces the installed tree in place, so re-reading package.json
  // reflects the new version even though this process still runs the old code.
  const after = installedVersion();
  const pulled = compareVersions(after, before) > 0 ? 1 : 0;
  return {
    ok: true,
    pulled,
    buildOk: true,
    output:
      pulled === 1 ? `Updated ${PACKAGE_NAME} v${before} -> v${after}.` : 'Already up to date.',
  };
}
