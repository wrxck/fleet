import { isGitRepo, getGitStatus } from './git.js';
import { execSafe } from './exec.js';
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
  const r = execSafe('git', ['fetch', 'origin', branch], { cwd: projectRoot, timeout: 60_000 });
  if (!r.ok) return { ok: false, reason: 'fetch-failed', detail: r.stderr || `exit ${r.exitCode}` };
  return { ok: true };
}

export type FastForwardResult =
  | { ok: true; changed: boolean; newHead: string }
  | { ok: false; reason: 'non-ff' | 'rev-parse-failed'; detail: string };

function revParse(projectRoot: string, ref: string): string | null {
  const r = execSafe('git', ['rev-parse', ref], { cwd: projectRoot, timeout: 10_000 });
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
  const merge = execSafe('git', ['merge', '--ff-only', `origin/${branch}`], { cwd: projectRoot, timeout: 30_000 });
  if (!merge.ok) {
    execSafe('git', ['merge', '--abort'], { cwd: projectRoot, timeout: 10_000 });
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
