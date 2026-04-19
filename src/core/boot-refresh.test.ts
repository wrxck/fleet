import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as git from './git.js';
import type { GitStatus } from './git.js';
import { preflight } from './boot-refresh.js';

vi.mock('./git.js');

function status(overrides: Partial<GitStatus> = {}): GitStatus {
  return {
    initialised: true,
    branch: 'main',
    branches: ['main'],
    remoteName: 'origin',
    remoteUrl: 'https://example.com/repo.git',
    clean: true,
    staged: 0,
    modified: 0,
    untracked: 0,
    ahead: 0,
    behind: 0,
    ...overrides,
  };
}

describe('preflight', () => {
  beforeEach(() => vi.resetAllMocks());

  it('ok when git initialised, has remote, on branch, clean', () => {
    vi.mocked(git.isGitRepo).mockReturnValue(true);
    vi.mocked(git.getGitStatus).mockReturnValue(status());
    expect(preflight('/tmp/app')).toEqual({ ok: true, branch: 'main' });
  });

  it('skips when not a git repo', () => {
    vi.mocked(git.isGitRepo).mockReturnValue(false);
    expect(preflight('/tmp/app')).toEqual({ ok: false, reason: 'not-a-git-repo' });
  });

  it('skips when no remote configured', () => {
    vi.mocked(git.isGitRepo).mockReturnValue(true);
    vi.mocked(git.getGitStatus).mockReturnValue(status({ remoteName: '', remoteUrl: '' }));
    expect(preflight('/tmp/app')).toEqual({ ok: false, reason: 'no-remote' });
  });

  it('skips on detached HEAD (branch empty)', () => {
    vi.mocked(git.isGitRepo).mockReturnValue(true);
    vi.mocked(git.getGitStatus).mockReturnValue(status({ branch: '' }));
    expect(preflight('/tmp/app')).toEqual({ ok: false, reason: 'detached-head' });
  });

  it('skips on detached HEAD (branch === "HEAD")', () => {
    vi.mocked(git.isGitRepo).mockReturnValue(true);
    vi.mocked(git.getGitStatus).mockReturnValue(status({ branch: 'HEAD' }));
    expect(preflight('/tmp/app')).toEqual({ ok: false, reason: 'detached-head' });
  });

  it('skips when working tree dirty', () => {
    vi.mocked(git.isGitRepo).mockReturnValue(true);
    vi.mocked(git.getGitStatus).mockReturnValue(status({ clean: false, modified: 1 }));
    expect(preflight('/tmp/app')).toEqual({ ok: false, reason: 'dirty-tree' });
  });
});
