import { existsSync } from 'node:fs';
import { isGitRepo, getGitStatus } from './git.js';
import { execGit } from './exec.js';
import type { AppEntry } from './registry.js';
import { load, save } from './registry.js';
import { composeBuild } from './docker.js';

export type PreflightResult =
  | { ok: true; branch: string }
  | { ok: false; reason: 'not-a-git-repo' | 'no-remote' | 'detached-head' | 'dirty-tree' };

export function preflight(projectRoot: string): PreflightResult {
  if (!isGitRepo(projectRoot)) return { ok: false, reason: 'not-a-git-repo' };
  const s = getGitStatus(projectRoot);
  if (!s.remoteName) return { ok: false, reason: 'no-remote' };
  if (!s.branch || s.branch === 'HEAD') return { ok: false, reason: 'detached-head' };
  if (!s.clean) return { ok: false, reason: 'dirty-tree' };
  return { ok: true, branch: s.branch };
}

export type FetchResult =
  | { ok: true }
  | { ok: false; reason: 'fetch-failed'; detail: string };

export function fetchOrigin(projectRoot: string, branch: string): FetchResult {
  const r = execGit(['fetch', 'origin', branch], { cwd: projectRoot, timeout: 60_000 });
  if (!r.ok) return { ok: false, reason: 'fetch-failed', detail: r.stderr || `exit ${r.exitCode}` };
  return { ok: true };
}

export type FastForwardResult =
  | { ok: true; changed: boolean; newHead: string }
  | { ok: false; reason: 'non-ff' | 'rev-parse-failed'; detail: string };

function revParse(projectRoot: string, ref: string): string | null {
  const r = execGit(['rev-parse', ref], { cwd: projectRoot, timeout: 10_000 });
  return r.ok ? r.stdout.trim() : null;
}

export function fastForward(projectRoot: string, branch: string): FastForwardResult {
  const local = revParse(projectRoot, 'HEAD');
  if (!local) {
    return { ok: false, reason: 'rev-parse-failed', detail: 'rev-parse HEAD or origin/branch failed' };
  }
  const remote = revParse(projectRoot, `origin/${branch}`);
  if (!remote) {
    return { ok: false, reason: 'rev-parse-failed', detail: 'rev-parse HEAD or origin/branch failed' };
  }
  if (local === remote) return { ok: true, changed: false, newHead: local };
  const merge = execGit(['merge', '--ff-only', `origin/${branch}`], { cwd: projectRoot, timeout: 30_000 });
  if (!merge.ok) {
    execGit(['merge', '--abort'], { cwd: projectRoot, timeout: 10_000 });
    return { ok: false, reason: 'non-ff', detail: merge.stderr || `exit ${merge.exitCode}` };
  }
  const newHead = revParse(projectRoot, 'HEAD');
  return { ok: true, changed: true, newHead: newHead ?? remote };
}

export type BuildResult =
  | { ok: true; built: boolean }
  | { ok: false; reason: 'build-failed' };

export function buildIfStale(app: AppEntry, currentHead: string): BuildResult {
  if (app.lastBuiltCommit && app.lastBuiltCommit === currentHead) {
    return { ok: true, built: false };
  }
  const ok = composeBuild(app.composePath, app.composeFile, app.name);
  if (!ok) return { ok: false, reason: 'build-failed' };
  return { ok: true, built: true };
}

export function recordBuiltCommit(appName: string, commit: string): void {
  const reg = load();
  const i = reg.apps.findIndex(a => a.name === appName);
  if (i < 0) return;
  reg.apps[i] = { ...reg.apps[i], lastBuiltCommit: commit };
  save(reg);
}

export const KILL_SWITCH = '/etc/fleet/no-auto-refresh';

function killSwitchPath(): string {
  return process.env.FLEET_KILL_SWITCH ?? KILL_SWITCH;
}
export const DEFAULT_WALL_CLOCK_MS = 900_000;

export type RefreshResult =
  | { kind: 'refreshed'; head: string; built: boolean }
  | { kind: 'no-change'; head: string }
  | { kind: 'skipped'; reason: string }
  | { kind: 'failed-safe'; step: string; detail: string };

export interface RefreshOptions {
  wallClockMs?: number;
}

async function doRefresh(app: AppEntry): Promise<RefreshResult> {
  const pre = preflight(app.composePath);
  if (!pre.ok) return { kind: 'skipped', reason: pre.reason };
  const fetched = fetchOrigin(app.composePath, pre.branch);
  if (!fetched.ok) return { kind: 'failed-safe', step: 'fetch', detail: fetched.detail };
  const ff = fastForward(app.composePath, pre.branch);
  if (!ff.ok) return { kind: 'failed-safe', step: 'merge', detail: ff.detail };
  const build = buildIfStale(app, ff.newHead);
  if (!build.ok) return { kind: 'failed-safe', step: 'build', detail: build.reason };
  if (build.built) recordBuiltCommit(app.name, ff.newHead);
  if (!ff.changed && !build.built) return { kind: 'no-change', head: ff.newHead };
  return { kind: 'refreshed', head: ff.newHead, built: build.built };
}

function isKillSwitchActive(): boolean {
  try {
    return existsSync(killSwitchPath());
  } catch {
    return false;  // permission error or similar — assume no kill switch, let refresh proceed
  }
}

export async function refresh(app: AppEntry, opts: RefreshOptions = {}): Promise<RefreshResult> {
  if (isKillSwitchActive()) return { kind: 'skipped', reason: 'kill-switch' };
  const cap = opts.wallClockMs ?? DEFAULT_WALL_CLOCK_MS;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race<RefreshResult>([
      doRefresh(app),
      new Promise<RefreshResult>((resolve) => {
        timer = setTimeout(
          () => resolve({ kind: 'failed-safe', step: 'wall-clock', detail: `exceeded ${cap}ms` }),
          cap,
        );
      }),
    ]);
  } catch (err) {
    return { kind: 'failed-safe', step: 'exception', detail: err instanceof Error ? err.message : String(err) };
  } finally {
    if (timer) clearTimeout(timer);
  }
}
