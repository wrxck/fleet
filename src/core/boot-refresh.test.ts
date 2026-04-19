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

import { fastForward, buildIfStale, recordBuiltCommit } from './boot-refresh.js';
import * as docker from './docker.js';
import * as registry from './registry.js';
import type { AppEntry } from './registry.js';

vi.mock('./docker.js');
vi.mock('./registry.js');

function app(overrides: Partial<AppEntry> = {}): AppEntry {
  return {
    name: 'x',
    displayName: 'x',
    composePath: '/tmp/x',
    composeFile: null,
    serviceName: 'x',
    domains: [],
    port: null,
    usesSharedDb: false,
    type: 'service',
    containers: [],
    dependsOnDatabases: false,
    registeredAt: '',
    ...overrides,
  };
}

describe('buildIfStale', () => {
  beforeEach(() => vi.resetAllMocks());

  it('no-op when HEAD matches lastBuiltCommit', () => {
    const r = buildIfStale(app({ lastBuiltCommit: 'abc' }), 'abc');
    expect(r).toEqual({ ok: true, built: false });
    expect(docker.composeBuild).not.toHaveBeenCalled();
  });

  it('builds when HEAD differs from lastBuiltCommit', () => {
    vi.mocked(docker.composeBuild).mockReturnValue(true);
    const r = buildIfStale(app({ lastBuiltCommit: 'old' }), 'new');
    expect(r).toEqual({ ok: true, built: true });
    expect(docker.composeBuild).toHaveBeenCalledWith('/tmp/x', null, 'x');
  });

  it('builds when lastBuiltCommit is undefined', () => {
    vi.mocked(docker.composeBuild).mockReturnValue(true);
    const r = buildIfStale(app({ lastBuiltCommit: undefined }), 'head');
    expect(r).toEqual({ ok: true, built: true });
  });

  it('returns build-failed when composeBuild returns false', () => {
    vi.mocked(docker.composeBuild).mockReturnValue(false);
    const r = buildIfStale(app({ lastBuiltCommit: 'old' }), 'new');
    expect(r).toEqual({ ok: false, reason: 'build-failed' });
  });
});

describe('recordBuiltCommit', () => {
  beforeEach(() => vi.resetAllMocks());

  it('updates app.lastBuiltCommit and saves registry', () => {
    const entry = app({ name: 'target', lastBuiltCommit: 'old' });
    const reg = {
      version: 1,
      apps: [entry],
      infrastructure: {
        databases: { serviceName: 'docker-databases', composePath: '' },
        nginx: { configPath: '/etc/nginx' },
      },
    };
    vi.mocked(registry.load).mockReturnValue(reg);
    recordBuiltCommit('target', 'new-sha');
    expect(registry.save).toHaveBeenCalledWith(expect.objectContaining({
      apps: expect.arrayContaining([expect.objectContaining({ name: 'target', lastBuiltCommit: 'new-sha' })]),
    }));
  });

  it('is a silent no-op when app not found', () => {
    const reg = {
      version: 1,
      apps: [],
      infrastructure: {
        databases: { serviceName: 'docker-databases', composePath: '' },
        nginx: { configPath: '/etc/nginx' },
      },
    };
    vi.mocked(registry.load).mockReturnValue(reg);
    recordBuiltCommit('ghost', 'new-sha');
    expect(registry.save).not.toHaveBeenCalled();
  });
});

describe('fastForward', () => {
  beforeEach(() => vi.resetAllMocks());

  function revParse(stdout: string) {
    return { ok: true, stdout, stderr: '', exitCode: 0 };
  }

  it('no-change when local HEAD == origin/branch', () => {
    vi.mocked(exec.execSafe)
      .mockReturnValueOnce(revParse('abc123'))   // rev-parse HEAD
      .mockReturnValueOnce(revParse('abc123'));  // rev-parse origin/main
    expect(fastForward('/tmp/app', 'main')).toEqual({ ok: true, changed: false, newHead: 'abc123' });
  });

  it('ok and changed when fast-forwards cleanly', () => {
    vi.mocked(exec.execSafe)
      .mockReturnValueOnce(revParse('aaa'))      // HEAD before
      .mockReturnValueOnce(revParse('bbb'))      // origin/main
      .mockReturnValueOnce(revParse(''))         // merge --ff-only succeeds
      .mockReturnValueOnce(revParse('bbb'));     // HEAD after
    expect(fastForward('/tmp/app', 'main')).toEqual({ ok: true, changed: true, newHead: 'bbb' });
  });

  it('aborts when merge is not fast-forward', () => {
    vi.mocked(exec.execSafe)
      .mockReturnValueOnce(revParse('aaa'))
      .mockReturnValueOnce(revParse('bbb'))
      .mockReturnValueOnce({ ok: false, stdout: '', stderr: 'Not possible to fast-forward, aborting.', exitCode: 128 })
      .mockReturnValueOnce(revParse(''));        // merge --abort
    const r = fastForward('/tmp/app', 'main');
    expect(r).toEqual({ ok: false, reason: 'non-ff', detail: 'Not possible to fast-forward, aborting.' });
    // confirm merge --abort was called
    expect(exec.execSafe).toHaveBeenCalledWith('git', ['merge', '--abort'], expect.objectContaining({ cwd: '/tmp/app' }));
  });

  it('returns rev-parse-failed when rev-parse HEAD fails', () => {
    vi.mocked(exec.execSafe).mockReturnValueOnce({ ok: false, stdout: '', stderr: 'fatal: bad HEAD', exitCode: 128 });
    expect(fastForward('/tmp/app', 'main')).toEqual({ ok: false, reason: 'rev-parse-failed', detail: 'rev-parse HEAD or origin/branch failed' });
  });

  it('returns rev-parse-failed when rev-parse origin/branch fails', () => {
    vi.mocked(exec.execSafe)
      .mockReturnValueOnce(revParse('aaa'))
      .mockReturnValueOnce({ ok: false, stdout: '', stderr: 'fatal: bad revision', exitCode: 128 });
    expect(fastForward('/tmp/app', 'main')).toEqual({ ok: false, reason: 'rev-parse-failed', detail: 'rev-parse HEAD or origin/branch failed' });
  });
});
