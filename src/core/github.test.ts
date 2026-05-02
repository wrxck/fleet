import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./exec.js', () => ({
  execSafe: vi.fn(),
}));

vi.mock('./errors.js', async () => {
  const actual = await vi.importActual<typeof import('./errors.js')>('./errors.js');
  return actual;
});

vi.mock('./validate.js', async () => {
  const actual = await vi.importActual<typeof import('./validate.js')>('./validate.js');
  return actual;
});

vi.mock('node:fs', async () => {
  const actual = await vi.importActual<typeof import('node:fs')>('node:fs');
  return { ...actual, writeFileSync: vi.fn(), unlinkSync: vi.fn() };
});

import { execSafe } from './exec.js';
import {
  GITHUB_ORG,
  isGhAuthenticated,
  requireGhAuth,
  repoExists,
  createRepo,
  getRepoUrl,
  createPullRequest,
  listPullRequests,
  protectBranch,
} from './github.js';
import { GitError } from './errors.js';

const mockExec = execSafe as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  mockExec.mockReturnValue({ ok: true, stdout: '', stderr: '' });
});

describe('GITHUB_ORG', () => {
  it('is heskethwebdesign', () => {
    expect(GITHUB_ORG).toBe('heskethwebdesign');
  });
});

describe('isGhAuthenticated', () => {
  it('returns true when gh auth status succeeds', () => {
    mockExec.mockReturnValue({ ok: true, stdout: '', stderr: '' });
    expect(isGhAuthenticated()).toBe(true);
  });

  it('returns false when gh auth status fails', () => {
    mockExec.mockReturnValue({ ok: false, stdout: '', stderr: 'not logged in' });
    expect(isGhAuthenticated()).toBe(false);
  });
});

describe('requireGhAuth', () => {
  it('does not throw when authenticated', () => {
    mockExec.mockReturnValue({ ok: true, stdout: '', stderr: '' });
    expect(() => requireGhAuth()).not.toThrow();
  });

  it('throws GitError when not authenticated', () => {
    mockExec.mockReturnValue({ ok: false, stdout: '', stderr: '' });
    expect(() => requireGhAuth()).toThrow(GitError);
  });

  it('error message contains instructions', () => {
    mockExec.mockReturnValue({ ok: false, stdout: '', stderr: '' });
    expect(() => requireGhAuth()).toThrow(/gh auth login/);
  });
});

describe('repoExists', () => {
  it('returns true when gh repo view succeeds', () => {
    mockExec
      .mockReturnValueOnce({ ok: true, stdout: '', stderr: '' })  // auth check
      .mockReturnValue({ ok: true, stdout: '{"name":"myapp"}', stderr: '' });
    // repoExists calls assertAppName then execSafe (no auth check)
    mockExec.mockReturnValue({ ok: true, stdout: '{"name":"myapp"}', stderr: '' });
    expect(repoExists('myapp')).toBe(true);
  });

  it('returns false when repo does not exist', () => {
    mockExec.mockReturnValue({ ok: false, stdout: '', stderr: 'not found' });
    expect(repoExists('myapp')).toBe(false);
  });

  it('throws on invalid app name (injection attempt)', () => {
    expect(() => repoExists('app; rm -rf /')).toThrow();
  });

  it('throws on path traversal in app name', () => {
    expect(() => repoExists('../etc/passwd')).toThrow();
  });
});

describe('getRepoUrl', () => {
  it('returns SSH git URL for the org', () => {
    const url = getRepoUrl('myapp');
    expect(url).toBe('git@github.com:heskethwebdesign/myapp.git');
  });

  it('includes the app name in the URL', () => {
    expect(getRepoUrl('cool-project')).toContain('cool-project');
  });
});

describe('createRepo', () => {
  it('throws when not authenticated', () => {
    mockExec.mockReturnValue({ ok: false, stdout: '', stderr: '' });
    expect(() => createRepo('myapp')).toThrow(GitError);
  });

  it('throws on invalid app name', () => {
    expect(() => createRepo('app; bad')).toThrow();
  });

  it('skips creation if repo already exists', () => {
    // auth ok, then repoExists ok
    mockExec.mockReturnValue({ ok: true, stdout: '{"name":"myapp"}', stderr: '' });
    expect(() => createRepo('myapp')).not.toThrow();
  });

  it('throws GitError if repo creation fails', () => {
    mockExec
      .mockReturnValueOnce({ ok: true, stdout: '', stderr: '' })  // auth
      .mockReturnValueOnce({ ok: false, stdout: '', stderr: '' }) // repoExists
      .mockReturnValueOnce({ ok: false, stdout: '', stderr: 'create failed' }); // create
    expect(() => createRepo('myapp')).toThrow(GitError);
  });
});

describe('createPullRequest', () => {
  it('throws when not authenticated', () => {
    mockExec.mockReturnValue({ ok: false, stdout: '', stderr: '' });
    expect(() =>
      createPullRequest('myapp', { title: 'My PR', head: 'feat/x', base: 'develop' })
    ).toThrow(GitError);
  });

  it('returns PR data from follow-up gh pr view JSON', () => {
    const prData = {
      number: 42,
      title: 'My PR',
      url: 'https://github.com/heskethwebdesign/myapp/pull/42',
      headRefName: 'feat/x',
      baseRefName: 'develop',
      state: 'open',
    };
    mockExec
      .mockReturnValueOnce({ ok: true, stdout: '', stderr: '' })  // auth
      .mockReturnValueOnce({ ok: true, stdout: 'https://github.com/heskethwebdesign/myapp/pull/42\n', stderr: '' })  // pr create (url-only)
      .mockReturnValueOnce({ ok: true, stdout: JSON.stringify(prData), stderr: '' });  // pr view
    const pr = createPullRequest('myapp', { title: 'My PR', head: 'feat/x', base: 'develop' });
    expect(pr.number).toBe(42);
    expect(pr.url).toContain('pull/42');
  });

  it('falls back to url-only when pr view fails', () => {
    mockExec
      .mockReturnValueOnce({ ok: true, stdout: '', stderr: '' })  // auth
      .mockReturnValueOnce({ ok: true, stdout: 'https://github.com/org/repo/pull/1\n', stderr: '' })  // pr create
      .mockReturnValueOnce({ ok: false, stdout: '', stderr: 'view failed' });  // pr view
    const pr = createPullRequest('myapp', { title: 'PR', head: 'feat/x', base: 'main' });
    expect(pr.title).toBe('PR');
    expect(pr.url).toContain('https://');
  });

  it('throws GitError when gh pr create fails', () => {
    mockExec
      .mockReturnValueOnce({ ok: true, stdout: '', stderr: '' })  // auth
      .mockReturnValueOnce({ ok: false, stdout: '', stderr: 'permission denied' });
    expect(() =>
      createPullRequest('myapp', { title: 'My PR', head: 'feat/x', base: 'develop' })
    ).toThrow(GitError);
  });
});

describe('listPullRequests', () => {
  it('throws when not authenticated', () => {
    mockExec.mockReturnValue({ ok: false, stdout: '', stderr: '' });
    expect(() => listPullRequests('myapp')).toThrow(GitError);
  });

  it('returns empty array when gh command fails', () => {
    mockExec
      .mockReturnValueOnce({ ok: true, stdout: '', stderr: '' })  // auth
      .mockReturnValueOnce({ ok: false, stdout: '', stderr: 'error' });
    expect(listPullRequests('myapp')).toEqual([]);
  });

  it('returns empty array when JSON parse fails', () => {
    mockExec
      .mockReturnValueOnce({ ok: true, stdout: '', stderr: '' })  // auth
      .mockReturnValueOnce({ ok: true, stdout: 'not json', stderr: '' });
    expect(listPullRequests('myapp')).toEqual([]);
  });

  it('returns mapped PR list', () => {
    const items = [
      { number: 1, title: 'PR1', url: 'url1', headRefName: 'feat/a', baseRefName: 'develop', state: 'open' },
      { number: 2, title: 'PR2', url: 'url2', headRefName: 'feat/b', baseRefName: 'main', state: 'closed' },
    ];
    mockExec
      .mockReturnValueOnce({ ok: true, stdout: '', stderr: '' })  // auth
      .mockReturnValueOnce({ ok: true, stdout: JSON.stringify(items), stderr: '' });
    const prs = listPullRequests('myapp', 'all');
    expect(prs).toHaveLength(2);
    expect(prs[0].number).toBe(1);
    expect(prs[1].head).toBe('feat/b');
  });

  it('defaults to open state', () => {
    mockExec
      .mockReturnValueOnce({ ok: true, stdout: '', stderr: '' })  // auth
      .mockReturnValueOnce({ ok: true, stdout: '[]', stderr: '' });
    listPullRequests('myapp');
    const args = mockExec.mock.calls[1][1] as string[];
    expect(args).toContain('open');
  });
});

describe('protectBranch', () => {
  it('throws when not authenticated', () => {
    mockExec.mockReturnValue({ ok: false, stdout: '', stderr: '' });
    expect(() => protectBranch('myapp', 'main')).toThrow(GitError);
  });

  it('returns true on success', () => {
    mockExec
      .mockReturnValueOnce({ ok: true, stdout: '', stderr: '' })  // auth
      .mockReturnValueOnce({ ok: true, stdout: '', stderr: '' }); // protect
    expect(protectBranch('myapp', 'main')).toBe(true);
  });

  it('returns false on failure', () => {
    mockExec
      .mockReturnValueOnce({ ok: true, stdout: '', stderr: '' })  // auth
      .mockReturnValueOnce({ ok: false, stdout: '', stderr: 'requires pro' }); // protect
    expect(protectBranch('myapp', 'main')).toBe(false);
  });
});
