import { writeFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { execSafe } from './exec.js';
import { GitError } from './errors.js';
import { assertAppName } from './validate.js';

export const GITHUB_ORG = process.env.FLEET_GITHUB_ORG ?? 'wrxck';

export interface PullRequest {
  number: number;
  title: string;
  url: string;
  head: string;
  base: string;
  state: string;
}

export function isGhAuthenticated(): boolean {
  return execSafe('gh', ['auth', 'status'], { timeout: 10_000 }).ok;
}

export function requireGhAuth(): void {
  if (!isGhAuthenticated()) {
    throw new GitError('gh cli not authenticated. Run: gh auth login');
  }
}

export function repoExists(name: string): boolean {
  assertAppName(name);
  return execSafe('gh', ['repo', 'view', `${GITHUB_ORG}/${name}`, '--json', 'name'], { timeout: 15_000 }).ok;
}

export function createRepo(name: string): void {
  requireGhAuth();
  assertAppName(name);
  if (repoExists(name)) return;
  const r = execSafe('gh', ['repo', 'create', `${GITHUB_ORG}/${name}`, '--private'], { timeout: 30_000 });
  if (!r.ok) throw new GitError(`failed to create repo: ${r.stderr}`);
}

export function getRepoUrl(name: string): string {
  return `git@github.com:${GITHUB_ORG}/${name}.git`;
}

export function createPullRequest(
  repo: string,
  opts: { title: string; body?: string; head: string; base: string },
): PullRequest {
  requireGhAuth();
  const r = execSafe('gh', [
    'pr', 'create',
    '--repo', `${GITHUB_ORG}/${repo}`,
    '--title', opts.title,
    '--body', opts.body ?? '',
    '--head', opts.head,
    '--base', opts.base,
    '--json', 'number,title,url,headRefName,baseRefName,state',
  ], { timeout: 30_000 });
  if (!r.ok) throw new GitError(`failed to create PR: ${r.stderr}`);

  try {
    const data = JSON.parse(r.stdout);
    return {
      number: data.number,
      title: data.title,
      url: data.url,
      head: data.headRefName,
      base: data.baseRefName,
      state: data.state,
    };
  } catch {
    // gh pr create outputs the url on success without --json working on create
    const url = r.stdout.trim().split('\n').pop() || '';
    return { number: 0, title: opts.title, url, head: opts.head, base: opts.base, state: 'open' };
  }
}

export function listPullRequests(repo: string, state: 'open' | 'closed' | 'all' = 'open'): PullRequest[] {
  requireGhAuth();
  const r = execSafe('gh', [
    'pr', 'list',
    '--repo', `${GITHUB_ORG}/${repo}`,
    '--state', state,
    '--json', 'number,title,url,headRefName,baseRefName,state',
  ], { timeout: 15_000 });
  if (!r.ok) return [];

  try {
    const items = JSON.parse(r.stdout) as Array<{
      number: number; title: string; url: string;
      headRefName: string; baseRefName: string; state: string;
    }>;
    return items.map(d => ({
      number: d.number, title: d.title, url: d.url,
      head: d.headRefName, base: d.baseRefName, state: d.state,
    }));
  } catch {
    return [];
  }
}

export function protectBranch(repo: string, branch: string): boolean {
  requireGhAuth();
  const protection = JSON.stringify({
    required_pull_request_reviews: {
      dismiss_stale_reviews: true,
      require_code_owner_reviews: false,
      required_approving_review_count: 1,
    },
    enforce_admins: false,
    required_status_checks: null,
    restrictions: null,
  });

  const tmpFile = join(tmpdir(), `fleet-protect-${repo}-${branch}.json`);
  writeFileSync(tmpFile, protection);
  try {
    const r = execSafe('gh', [
      'api', '-X', 'PUT',
      `repos/${GITHUB_ORG}/${repo}/branches/${branch}/protection`,
      '--input', tmpFile,
    ], { timeout: 15_000 });
    return r.ok;
  } finally {
    try { unlinkSync(tmpFile); } catch {}
  }
}
