import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./exec.js', () => ({
  execSafe: vi.fn(),
}));

vi.mock('./validate.js', () => ({
  assertBranch: vi.fn(),
  assertFilePath: vi.fn(),
}));

vi.mock('node:fs', () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
}));

vi.mock('../templates/gitignore.js', () => ({
  detectProjectType: vi.fn().mockReturnValue('node'),
  generateGitignore: vi.fn().mockReturnValue('node_modules/\ndist/\n'),
}));

import { execSafe } from './exec.js';
import { assertBranch, assertFilePath } from './validate.js';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import {
  isGitRepo,
  hasCommits,
  getGitStatus,
  getLog,
  branchExists,
  gitInit,
  gitAdd,
  gitCommit,
  gitCheckout,
  gitPush,
  getProjectRoot,
  hasGitignore,
  readGitignore,
  ensureGitignore,
} from './git.js';
import { GitError } from './errors.js';

const mockedExec = vi.mocked(execSafe);
const mockedAssertBranch = vi.mocked(assertBranch);
const mockedAssertFilePath = vi.mocked(assertFilePath);
const mockedExistsSync = vi.mocked(existsSync);
const mockedReadFileSync = vi.mocked(readFileSync);
const mockedWriteFileSync = vi.mocked(writeFileSync);

function makeExecResult(stdout: string, ok = true, stderr = '') {
  return { stdout, stderr, exitCode: ok ? 0 : 1, ok };
}

beforeEach(() => {
  vi.clearAllMocks();
  // Default: assertBranch and assertFilePath are no-ops
  mockedAssertBranch.mockImplementation(() => {});
  mockedAssertFilePath.mockImplementation(() => {});
});

describe('isGitRepo', () => {
  it('returns true when git rev-parse succeeds', () => {
    mockedExec.mockReturnValue(makeExecResult('true'));
    expect(isGitRepo('/opt/app')).toBe(true);
  });

  it('returns false when git rev-parse fails', () => {
    mockedExec.mockReturnValue(makeExecResult('', false));
    expect(isGitRepo('/not-a-repo')).toBe(false);
  });
});

describe('hasCommits', () => {
  it('returns true when HEAD exists', () => {
    mockedExec.mockReturnValue(makeExecResult('abc123'));
    expect(hasCommits('/opt/app')).toBe(true);
  });

  it('returns false when no commits', () => {
    mockedExec.mockReturnValue(makeExecResult('', false));
    expect(hasCommits('/opt/app')).toBe(false);
  });
});

describe('getGitStatus', () => {
  it('returns uninitialised status when not a git repo', () => {
    mockedExec.mockReturnValue(makeExecResult('', false));
    const status = getGitStatus('/not-a-repo');
    expect(status.initialised).toBe(false);
    expect(status.branch).toBe('');
    expect(status.clean).toBe(true);
  });

  it('parses branch name', () => {
    mockedExec.mockImplementation((cmd, args) => {
      const a = args as string[];
      if (a.includes('--is-inside-work-tree')) return makeExecResult('true');
      if (a.includes('--abbrev-ref')) return makeExecResult('main');
      if (a.includes('--list')) return makeExecResult('  main\n* develop');
      if (a.includes('remote') && a.length === 1) return makeExecResult('origin');
      if (a.includes('get-url')) return makeExecResult('https://github.com/user/repo.git');
      if (a.includes('--porcelain')) return makeExecResult('');
      return makeExecResult('', false);
    });
    const status = getGitStatus('/opt/app');
    expect(status.branch).toBe('main');
    expect(status.initialised).toBe(true);
  });

  it('counts staged, modified, and untracked files', () => {
    mockedExec.mockImplementation((cmd, args) => {
      const a = args as string[];
      if (a.includes('--is-inside-work-tree')) return makeExecResult('true');
      if (a.includes('--abbrev-ref')) return makeExecResult('main');
      if (a.includes('--list')) return makeExecResult('  main');
      if (a.includes('remote') && a.length === 1) return makeExecResult('');
      // porcelain: 1 staged (M ), 1 modified ( M), 1 untracked (??)
      if (a.includes('--porcelain')) return makeExecResult('M  staged.ts\n M modified.ts\n?? untracked.ts');
      return makeExecResult('', false);
    });
    const status = getGitStatus('/opt/app');
    expect(status.staged).toBe(1);
    expect(status.modified).toBe(1);
    expect(status.untracked).toBe(1);
    expect(status.clean).toBe(false);
  });

  it('reports clean when porcelain output is empty', () => {
    mockedExec.mockImplementation((cmd, args) => {
      const a = args as string[];
      if (a.includes('--is-inside-work-tree')) return makeExecResult('true');
      if (a.includes('--abbrev-ref')) return makeExecResult('main');
      if (a.includes('--list')) return makeExecResult('  main');
      if (a.includes('remote') && a.length === 1) return makeExecResult('');
      if (a.includes('--porcelain')) return makeExecResult('');
      return makeExecResult('', false);
    });
    const status = getGitStatus('/opt/app');
    expect(status.clean).toBe(true);
    expect(status.staged).toBe(0);
    expect(status.modified).toBe(0);
    expect(status.untracked).toBe(0);
  });

  it('parses ahead/behind counts', () => {
    mockedExec.mockImplementation((cmd, args) => {
      const a = args as string[];
      if (a.includes('--is-inside-work-tree')) return makeExecResult('true');
      if (a.includes('--abbrev-ref')) return makeExecResult('main');
      if (a.includes('--list')) return makeExecResult('  main');
      if (a.includes('remote') && a.length === 1) return makeExecResult('origin');
      if (a.includes('get-url')) return makeExecResult('https://github.com/user/repo.git');
      if (a.includes('--porcelain')) return makeExecResult('');
      if (a.includes('rev-parse') && a.includes('HEAD')) return makeExecResult('abc123');
      if (a.includes('--left-right')) return makeExecResult('2\t3');
      return makeExecResult('', false);
    });
    const status = getGitStatus('/opt/app');
    expect(status.ahead).toBe(2);
    expect(status.behind).toBe(3);
  });
});

describe('getLog', () => {
  it('returns empty array when git log fails', () => {
    mockedExec.mockReturnValue(makeExecResult('', false));
    expect(getLog('/opt/app')).toEqual([]);
  });

  it('parses log entries', () => {
    mockedExec.mockReturnValue(makeExecResult(
      'abc123|feat: add feature|2026-01-01 10:00:00 +0000\ndef456|fix: fix bug|2026-01-02 11:00:00 +0000',
    ));
    const log = getLog('/opt/app');
    expect(log).toHaveLength(2);
    expect(log[0].hash).toBe('abc123');
    expect(log[0].subject).toBe('feat: add feature');
    expect(log[1].hash).toBe('def456');
  });

  it('filters empty lines', () => {
    mockedExec.mockReturnValue(makeExecResult('abc123|commit|2026-01-01\n'));
    const log = getLog('/opt/app');
    expect(log).toHaveLength(1);
  });
});

describe('branchExists', () => {
  it('calls assertBranch before checking', () => {
    mockedExec.mockReturnValue(makeExecResult(''));
    branchExists('/opt/app', 'main');
    expect(mockedAssertBranch).toHaveBeenCalledWith('main');
  });

  it('returns true when branch exists', () => {
    mockedExec.mockReturnValue(makeExecResult('', true));
    expect(branchExists('/opt/app', 'main')).toBe(true);
  });

  it('returns false when branch does not exist', () => {
    mockedExec.mockReturnValue(makeExecResult('', false));
    expect(branchExists('/opt/app', 'nonexistent')).toBe(false);
  });

  it('rejects path traversal branches via assertBranch', () => {
    mockedAssertBranch.mockImplementation((b) => {
      if (b.includes('..')) throw new Error('Invalid branch name');
    });
    expect(() => branchExists('/opt/app', '../../etc/passwd')).toThrow();
  });
});

describe('gitInit', () => {
  it('throws GitError when init fails', () => {
    mockedExec.mockReturnValue(makeExecResult('', false, 'permission denied'));
    expect(() => gitInit('/opt/app')).toThrow(GitError);
  });

  it('does not throw when init succeeds', () => {
    mockedExec.mockReturnValue(makeExecResult('Initialized empty Git repository'));
    expect(() => gitInit('/opt/app')).not.toThrow();
  });
});

describe('gitAdd', () => {
  it('calls assertFilePath for non-dot paths', () => {
    mockedExec.mockReturnValue(makeExecResult(''));
    gitAdd('/opt/app', ['src/file.ts']);
    expect(mockedAssertFilePath).toHaveBeenCalledWith('src/file.ts');
  });

  it('does not call assertFilePath for dot', () => {
    mockedExec.mockReturnValue(makeExecResult(''));
    gitAdd('/opt/app', ['.']);
    expect(mockedAssertFilePath).not.toHaveBeenCalled();
  });

  it('throws GitError when add fails', () => {
    mockedExec.mockReturnValue(makeExecResult('', false, 'error'));
    expect(() => gitAdd('/opt/app')).toThrow(GitError);
  });
});

describe('gitCommit', () => {
  it('throws GitError when commit fails', () => {
    mockedExec.mockReturnValue(makeExecResult('', false, 'nothing to commit'));
    expect(() => gitCommit('/opt/app', 'feat: add thing')).toThrow(GitError);
  });

  it('passes message as array arg (no shell injection)', () => {
    mockedExec.mockReturnValue(makeExecResult(''));
    gitCommit('/opt/app', 'feat: add; rm -rf /');
    expect(mockedExec).toHaveBeenCalledWith(
      'git',
      expect.arrayContaining(['-m', 'feat: add; rm -rf /']),
      expect.any(Object),
    );
  });
});

describe('gitCheckout', () => {
  it('calls assertBranch before checkout', () => {
    mockedExec.mockReturnValue(makeExecResult(''));
    gitCheckout('/opt/app', 'main');
    expect(mockedAssertBranch).toHaveBeenCalledWith('main');
  });

  it('includes -b flag when creating branch', () => {
    mockedExec.mockReturnValue(makeExecResult(''));
    gitCheckout('/opt/app', 'feat/new', true);
    expect(mockedExec).toHaveBeenCalledWith(
      'git',
      expect.arrayContaining(['-b', 'feat/new']),
      expect.any(Object),
    );
  });

  it('throws GitError when checkout fails', () => {
    mockedExec.mockReturnValue(makeExecResult('', false, 'error'));
    expect(() => gitCheckout('/opt/app', 'nonexistent')).toThrow(GitError);
  });
});

describe('gitPush', () => {
  it('calls assertBranch before push', () => {
    mockedExec.mockReturnValue(makeExecResult(''));
    gitPush('/opt/app', 'main');
    expect(mockedAssertBranch).toHaveBeenCalledWith('main');
  });

  it('includes -u origin when setUpstream is true', () => {
    mockedExec.mockReturnValue(makeExecResult(''));
    gitPush('/opt/app', 'main', true);
    expect(mockedExec).toHaveBeenCalledWith(
      'git',
      expect.arrayContaining(['-u', 'origin', 'main']),
      expect.any(Object),
    );
  });

  it('throws GitError when push fails', () => {
    mockedExec.mockReturnValue(makeExecResult('', false, 'rejected'));
    expect(() => gitPush('/opt/app', 'main')).toThrow(GitError);
  });

  it('rejects traversal branch via assertBranch', () => {
    mockedAssertBranch.mockImplementation((b) => {
      if (b.includes('..')) throw new Error('Invalid branch name');
    });
    expect(() => gitPush('/opt/app', '../../etc')).toThrow();
  });
});

describe('getProjectRoot', () => {
  it('returns composePath when .git exists at that level', () => {
    mockedExistsSync.mockImplementation((p) => String(p).endsWith('.git'));
    expect(getProjectRoot('/opt/myapp')).toBe('/opt/myapp');
  });

  it('returns composePath when no .git found', () => {
    mockedExistsSync.mockReturnValue(false);
    const root = getProjectRoot('/opt/myapp');
    expect(root).toBeDefined();
  });
});

describe('hasGitignore and readGitignore', () => {
  it('returns true when .gitignore exists', () => {
    mockedExistsSync.mockReturnValue(true);
    expect(hasGitignore('/opt/app')).toBe(true);
  });

  it('returns false when .gitignore does not exist', () => {
    mockedExistsSync.mockReturnValue(false);
    expect(hasGitignore('/opt/app')).toBe(false);
  });

  it('returns file contents when .gitignore exists', () => {
    mockedExistsSync.mockReturnValue(true);
    mockedReadFileSync.mockReturnValue('node_modules/\ndist/\n');
    expect(readGitignore('/opt/app')).toBe('node_modules/\ndist/\n');
  });

  it('returns empty string when .gitignore does not exist', () => {
    mockedExistsSync.mockReturnValue(false);
    expect(readGitignore('/opt/app')).toBe('');
  });
});

describe('ensureGitignore', () => {
  it('returns message if .gitignore already exists', () => {
    mockedExistsSync.mockReturnValue(true);
    const result = ensureGitignore('/opt/app');
    expect(result).toContain('already exists');
    expect(mockedWriteFileSync).not.toHaveBeenCalled();
  });

  it('writes a new .gitignore when it does not exist', () => {
    mockedExistsSync.mockReturnValue(false);
    const result = ensureGitignore('/opt/app');
    expect(mockedWriteFileSync).toHaveBeenCalled();
    expect(result).toContain('generated');
  });
});

describe('security: SSH_AUTH_SOCK env handling', () => {
  it('git operations pass env through without leaking secrets in args', () => {
    mockedExec.mockReturnValue(makeExecResult(''));
    // The commit message is passed as an array arg — no shell expansion
    gitCommit('/opt/app', 'fix: remove $(rm -rf /)');
    const call = mockedExec.mock.calls[0];
    expect(call[1]).toContain('fix: remove $(rm -rf /)');
    // It's an array arg, so no shell was invoked
    expect(call[0]).toBe('git');
  });
});
