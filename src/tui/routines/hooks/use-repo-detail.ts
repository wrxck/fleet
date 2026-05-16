import { useEffect, useRef, useState } from 'react';

import type { AppEntry } from '@/core/registry.js';
import { execSafe } from '@/core/exec.js';
import { getGitStatus, type GitStatus } from '@/core/git.js';
import { getMultipleServiceStatuses, type ServiceStatus } from '@/core/systemd.js';

export interface OpenPr {
  number: number;
  title: string;
  author: string;
  updatedAt: string;
  url: string;
  isDraft: boolean;
}

export interface LastCommit {
  hash: string;
  subject: string;
  date: string;
  author: string;
}

export interface RepoDetailSnapshot {
  loading: boolean;
  error: string | null;
  git: GitStatus | null;
  lastCommit: LastCommit | null;
  openPrs: OpenPr[] | null;
  service: ServiceStatus | null;
  runningContainers: number | null;
  totalContainers: number | null;
  refreshedAt: number;
}

function fetchLastCommit(cwd: string): LastCommit | null {
  const res = execSafe('git', ['-C', cwd, 'log', '-1', '--format=%H%x09%s%x09%ad%x09%an', '--date=iso-strict'], { timeout: 5000 });
  if (!res.ok || !res.stdout) return null;
  const [hash, subject, date, author] = res.stdout.split('\t');
  if (!hash || !subject) return null;
  return { hash: hash.slice(0, 8), subject, date, author };
}

function fetchOpenPrs(cwd: string): OpenPr[] | null {
  const res = execSafe('gh', [
    'pr', 'list', '--state', 'open',
    '--json', 'number,title,author,updatedAt,url,isDraft',
    '--limit', '20',
  ], { cwd, timeout: 8000 });
  if (!res.ok) return null;
  try {
    const raw = JSON.parse(res.stdout) as Array<{
      number: number;
      title: string;
      author: { login: string };
      updatedAt: string;
      url: string;
      isDraft: boolean;
    }>;
    return raw.map(p => ({
      number: p.number,
      title: p.title,
      author: p.author?.login ?? 'unknown',
      updatedAt: p.updatedAt,
      url: p.url,
      isDraft: p.isDraft,
    }));
  } catch {
    return null;
  }
}

function fetchContainerCounts(project: string): { running: number; total: number } | null {
  const res = execSafe('docker', [
    'ps', '--all',
    '--filter', `label=com.docker.compose.project=${project}`,
    '--format', '{{.State}}',
  ], { timeout: 5000 });
  if (!res.ok) return null;
  const states = res.stdout.split('\n').map(s => s.trim()).filter(Boolean);
  return { running: states.filter(s => s === 'running').length, total: states.length };
}

export function useRepoDetail(app: AppEntry | null): RepoDetailSnapshot & { refresh(): void } {
  const [snapshot, setSnapshot] = useState<RepoDetailSnapshot>({
    loading: false,
    error: null,
    git: null,
    lastCommit: null,
    openPrs: null,
    service: null,
    runningContainers: null,
    totalContainers: null,
    refreshedAt: 0,
  });
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  const load = (): void => {
    if (!app) return;
    setSnapshot(s => ({ ...s, loading: true, error: null }));

    try {
      const cwd = app.composePath ?? '';
      const git = cwd ? getGitStatus(cwd) : null;
      const lastCommit = cwd ? fetchLastCommit(cwd) : null;
      const openPrs = cwd ? fetchOpenPrs(cwd) : null;
      const service = app.serviceName ? getMultipleServiceStatuses([app.serviceName]).get(app.serviceName) ?? null : null;
      const containers = fetchContainerCounts(app.name);
      if (!mounted.current) return;
      setSnapshot({
        loading: false,
        error: null,
        git,
        lastCommit,
        openPrs,
        service,
        runningContainers: containers?.running ?? null,
        totalContainers: containers?.total ?? null,
        refreshedAt: Date.now(),
      });
    } catch (err) {
      if (!mounted.current) return;
      setSnapshot(s => ({ ...s, loading: false, error: (err as Error).message }));
    }
  };

  useEffect(() => {
    if (!app) return;
    load();
    const id = setInterval(load, 30_000);
    return () => clearInterval(id);
  }, [app?.name]);

  return { ...snapshot, refresh: load };
}
