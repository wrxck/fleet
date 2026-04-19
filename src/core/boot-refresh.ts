import { isGitRepo, getGitStatus } from './git.js';

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
