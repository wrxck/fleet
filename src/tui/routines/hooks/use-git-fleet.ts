import { useEffect, useState } from 'react';

import type { AppEntry } from '@/core/registry.js';
import { execSafe } from '@/core/exec.js';
import { getGitStatus } from '@/core/git.js';

export interface FleetPr {
  repo: string;
  number: number;
  title: string;
  author: string;
  updatedAt: string;
  url: string;
  isDraft: boolean;
  reviewDecision: string | null;
}

export interface FleetBranchState {
  repo: string;
  branch: string;
  ahead: number;
  behind: number;
  clean: boolean;
  dirtyCount: number;
  releasePending: number;
}

export interface GitFleetSnapshot {
  loading: boolean;
  prs: FleetPr[];
  branchStates: FleetBranchState[];
  refreshedAt: number;
  errors: { repo: string; message: string }[];
}

function listPrsForRepo(cwd: string, repo: string): FleetPr[] {
  const res = execSafe('gh', [
    'pr', 'list', '--state', 'open',
    '--json', 'number,title,author,updatedAt,url,isDraft,reviewDecision',
    '--limit', '20',
  ], { cwd, timeout: 8000 });
  if (!res.ok) return [];
  try {
    const raw = JSON.parse(res.stdout) as Array<{
      number: number;
      title: string;
      author: { login: string };
      updatedAt: string;
      url: string;
      isDraft: boolean;
      reviewDecision: string | null;
    }>;
    return raw.map(p => ({
      repo,
      number: p.number,
      title: p.title,
      author: p.author?.login ?? 'unknown',
      updatedAt: p.updatedAt,
      url: p.url,
      isDraft: p.isDraft,
      reviewDecision: p.reviewDecision,
    }));
  } catch {
    return [];
  }
}

function countReleasePending(cwd: string): number {
  const res = execSafe('git', ['-C', cwd, 'rev-list', '--count', 'origin/main..origin/develop'], { timeout: 5000 });
  if (!res.ok) return 0;
  return parseInt(res.stdout.trim() || '0', 10) || 0;
}

export function useGitFleet(apps: AppEntry[]): GitFleetSnapshot & { refresh(): void } {
  const [state, setState] = useState<GitFleetSnapshot>({
    loading: false,
    prs: [],
    branchStates: [],
    refreshedAt: 0,
    errors: [],
  });

  const load = (): void => {
    setState(s => ({ ...s, loading: true }));
    const prs: FleetPr[] = [];
    const branchStates: FleetBranchState[] = [];
    const errors: { repo: string; message: string }[] = [];

    for (const app of apps) {
      const cwd = app.composePath ?? '';
      if (!cwd) continue;
      try {
        const git = getGitStatus(cwd);
        if (git.initialised) {
          branchStates.push({
            repo: app.name,
            branch: git.branch,
            ahead: git.ahead,
            behind: git.behind,
            clean: git.clean,
            dirtyCount: git.modified + git.staged + git.untracked,
            releasePending: countReleasePending(cwd),
          });
        }
        prs.push(...listPrsForRepo(cwd, app.name));
      } catch (err) {
        errors.push({ repo: app.name, message: (err as Error).message });
      }
    }

    prs.sort((a, b) => new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime());
    setState({ loading: false, prs, branchStates, refreshedAt: Date.now(), errors });
  };

  useEffect(() => {
    if (apps.length === 0) return;
    load();
    const id = setInterval(load, 60_000);
    return () => clearInterval(id);
  }, [apps.map(a => a.name).join('|')]);

  return { ...state, refresh: load };
}
