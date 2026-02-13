import { existsSync, writeFileSync, readFileSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';

import { exec } from './exec.js';
import { GitError } from './errors.js';
import { detectProjectType, generateGitignore } from '../templates/gitignore.js';

const SSH_AGENT_SOCK = '/tmp/fleet-ssh-agent.sock';
if (existsSync(SSH_AGENT_SOCK)) {
  process.env.SSH_AUTH_SOCK = SSH_AGENT_SOCK;
}

export interface GitStatus {
  initialised: boolean;
  branch: string;
  branches: string[];
  remoteName: string;
  remoteUrl: string;
  clean: boolean;
  staged: number;
  modified: number;
  untracked: number;
  ahead: number;
  behind: number;
}

export interface GitLogEntry {
  hash: string;
  subject: string;
  date: string;
}

export function isGitRepo(cwd: string): boolean {
  return exec('git rev-parse --is-inside-work-tree', { cwd }).ok;
}

export function hasCommits(cwd: string): boolean {
  return exec('git rev-parse HEAD', { cwd }).ok;
}

export function getGitStatus(cwd: string): GitStatus {
  if (!isGitRepo(cwd)) {
    return {
      initialised: false, branch: '', branches: [], remoteName: '', remoteUrl: '',
      clean: true, staged: 0, modified: 0, untracked: 0, ahead: 0, behind: 0,
    };
  }

  const branch = exec('git rev-parse --abbrev-ref HEAD', { cwd }).stdout || '';
  const branchResult = exec('git branch --list --no-color', { cwd });
  const branches = branchResult.stdout
    .split('\n')
    .map(b => b.replace(/^\*?\s+/, '').trim())
    .filter(Boolean);

  const remoteName = exec('git remote', { cwd }).stdout.split('\n')[0] || '';
  const remoteUrl = remoteName
    ? exec(`git remote get-url ${remoteName}`, { cwd }).stdout
    : '';

  const porcelain = exec('git status --porcelain', { cwd }).stdout;
  const lines = porcelain ? porcelain.split('\n') : [];
  let staged = 0, modified = 0, untracked = 0;
  for (const line of lines) {
    const x = line[0], y = line[1];
    if (x === '?' && y === '?') untracked++;
    else if (x !== ' ' && x !== '?') staged++;
    if (y !== ' ' && y !== '?') modified++;
  }

  let ahead = 0, behind = 0;
  if (remoteName && hasCommits(cwd)) {
    const abResult = exec(`git rev-list --left-right --count HEAD...${remoteName}/${branch}`, { cwd });
    if (abResult.ok) {
      const parts = abResult.stdout.split(/\s+/);
      ahead = parseInt(parts[0], 10) || 0;
      behind = parseInt(parts[1], 10) || 0;
    }
  }

  return {
    initialised: true, branch, branches, remoteName, remoteUrl,
    clean: lines.length === 0, staged, modified, untracked, ahead, behind,
  };
}

export function getLog(cwd: string, count = 10): GitLogEntry[] {
  const result = exec(`git log --oneline --format="%H|%s|%ci" -${count}`, { cwd });
  if (!result.ok) return [];
  return result.stdout.split('\n').filter(Boolean).map(line => {
    const [hash, subject, ...dateParts] = line.split('|');
    return { hash, subject, date: dateParts.join('|') };
  });
}

export function hasGitignore(cwd: string): boolean {
  return existsSync(join(cwd, '.gitignore'));
}

export function readGitignore(cwd: string): string {
  const p = join(cwd, '.gitignore');
  return existsSync(p) ? readFileSync(p, 'utf-8') : '';
}

export function branchExists(cwd: string, branch: string): boolean {
  return exec(`git show-ref --verify --quiet refs/heads/${branch}`, { cwd }).ok;
}

// walk up from composePath to find git root
const SUBDIR_NAMES = new Set(['server', 'app', 'backend', 'frontend']);

export function getProjectRoot(composePath: string): string {
  if (existsSync(join(composePath, '.git'))) return composePath;

  let dir = composePath;
  for (let i = 0; i < 5; i++) {
    const parent = dirname(dir);
    if (parent === dir) break;
    if (existsSync(join(parent, '.git'))) return parent;
    dir = parent;
  }

  // if current dir is a known subdir name, go up
  dir = composePath;
  for (let i = 0; i < 3; i++) {
    if (SUBDIR_NAMES.has(basename(dir))) {
      dir = dirname(dir);
    } else {
      break;
    }
  }

  return dir;
}

export function gitInit(cwd: string): void {
  const r = exec('git init -b main', { cwd });
  if (!r.ok) throw new GitError(`git init failed: ${r.stderr}`);
}

export function gitAdd(cwd: string, paths: string[] = ['.']): void {
  const r = exec(`git add ${paths.join(' ')}`, { cwd });
  if (!r.ok) throw new GitError(`git add failed: ${r.stderr}`);
}

export function gitCommit(cwd: string, message: string): void {
  const r = exec(`git commit -m "${message.replace(/"/g, '\\"')}"`, { cwd });
  if (!r.ok) throw new GitError(`git commit failed: ${r.stderr}`);
}

export function gitCheckout(cwd: string, branch: string, create = false): void {
  const flag = create ? '-b' : '';
  const r = exec(`git checkout ${flag} ${branch}`, { cwd });
  if (!r.ok) throw new GitError(`git checkout failed: ${r.stderr}`);
}

export function gitPush(cwd: string, branch: string, setUpstream = false): void {
  const flag = setUpstream ? '-u origin' : '';
  const r = exec(`git push ${flag} ${branch}`, { cwd, timeout: 60_000 });
  if (!r.ok) throw new GitError(`git push failed: ${r.stderr}`);
}

export function gitPushAll(cwd: string): void {
  const r = exec('git push --all origin', { cwd, timeout: 60_000 });
  if (!r.ok) throw new GitError(`git push --all failed: ${r.stderr}`);
}

export function gitSetRemoteUrl(cwd: string, url: string): void {
  const r = exec(`git remote set-url origin ${url}`, { cwd });
  if (!r.ok) throw new GitError(`git remote set-url failed: ${r.stderr}`);
}

export function gitAddRemote(cwd: string, name: string, url: string): void {
  const r = exec(`git remote add ${name} ${url}`, { cwd });
  if (!r.ok) throw new GitError(`git remote add failed: ${r.stderr}`);
}

export function writeGitignore(cwd: string, content: string): void {
  writeFileSync(join(cwd, '.gitignore'), content);
}

export function ensureGitignore(cwd: string): string {
  if (hasGitignore(cwd)) return '.gitignore already exists';
  const type = detectProjectType(cwd);
  writeGitignore(cwd, generateGitignore(type));
  return `generated .gitignore (${type})`;
}
