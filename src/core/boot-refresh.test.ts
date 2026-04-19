import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as git from './git.js';
import type { GitStatus } from './git.js';
import * as exec from './exec.js';
import { preflight, fetchOrigin } from './boot-refresh.js';

vi.mock('./git.js');
vi.mock('./exec.js');

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

describe('fetchOrigin', () => {
  beforeEach(() => vi.resetAllMocks());

  it('returns ok on successful fetch', () => {
    vi.mocked(exec.execSafe).mockReturnValue({ ok: true, stdout: '', stderr: '', exitCode: 0 });
    expect(fetchOrigin('/tmp/app', 'main')).toEqual({ ok: true });
    expect(exec.execSafe).toHaveBeenCalledWith(
      'git',
      ['fetch', 'origin', 'main'],
      expect.objectContaining({ cwd: '/tmp/app', timeout: 60_000 }),
    );
  });

  it('returns fail on non-zero exit', () => {
    vi.mocked(exec.execSafe).mockReturnValue({ ok: false, stdout: '', stderr: 'auth failed', exitCode: 128 });
    expect(fetchOrigin('/tmp/app', 'main')).toEqual({ ok: false, reason: 'fetch-failed', detail: 'auth failed' });
  });

  it('uses exit code message if stderr is empty', () => {
    vi.mocked(exec.execSafe).mockReturnValue({ ok: false, stdout: '', stderr: '', exitCode: 124 });
    expect(fetchOrigin('/tmp/app', 'main')).toEqual({ ok: false, reason: 'fetch-failed', detail: 'exit 124' });
  });
});
