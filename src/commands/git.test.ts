import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../core/registry.js', () => ({
  load: vi.fn(),
  findApp: vi.fn(),
}));

vi.mock('../core/git.js', () => ({
  getGitStatus: vi.fn(),
  getProjectRoot: vi.fn(),
  gitAdd: vi.fn(),
  gitCommit: vi.fn(),
  gitCheckout: vi.fn(),
  gitPush: vi.fn(),
}));

vi.mock('../core/git-onboard.js', () => ({
  detectScenario: vi.fn(),
  describeOnboardPlan: vi.fn(),
  executeOnboard: vi.fn(),
}));

vi.mock('../core/github.js', () => ({
  createPullRequest: vi.fn(),
  listPullRequests: vi.fn(),
}));

vi.mock('../ui/confirm.js', () => ({
  confirm: vi.fn(),
}));

vi.mock('../ui/output.js', () => ({
  c: { green: '', red: '', yellow: '', dim: '', bold: '', reset: '' },
  heading: vi.fn(),
  table: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
}));

import { load, findApp } from '../core/registry.js';
import { getGitStatus, getProjectRoot } from '../core/git.js';
import { error } from '../ui/output.js';
import { gitCommand } from './git.js';

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
  vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
});

describe('gitCommand', () => {
  it('exits with error for unknown subcommand', async () => {
    await expect(gitCommand(['unknown'])).rejects.toThrow('exit');
    expect(error).toHaveBeenCalled();
  });

  it('exits with error for no subcommand', async () => {
    await expect(gitCommand([])).rejects.toThrow('exit');
  });
});

describe('git status', () => {
  it('shows status for a single app', async () => {
    const app = { name: 'myapp', composePath: '/opt/myapp', gitOnboardedAt: null };
    vi.mocked(load).mockReturnValue({ apps: [app] } as any);
    vi.mocked(findApp).mockReturnValue(app as any);
    vi.mocked(getProjectRoot).mockReturnValue('/opt/myapp');
    vi.mocked(getGitStatus).mockReturnValue({
      initialised: true, branch: 'main', branches: ['main'],
      remoteUrl: 'https://github.com/test/repo', clean: true,
      staged: 0, modified: 0, untracked: 0, ahead: 0, behind: 0,
    });

    await gitCommand(['status', 'myapp']);
    expect(getGitStatus).toHaveBeenCalledWith('/opt/myapp');
  });

  it('outputs JSON when --json flag passed', async () => {
    const app = { name: 'myapp', composePath: '/opt/myapp', gitOnboardedAt: null };
    vi.mocked(load).mockReturnValue({ apps: [app] } as any);
    vi.mocked(findApp).mockReturnValue(app as any);
    vi.mocked(getProjectRoot).mockReturnValue('/opt/myapp');
    vi.mocked(getGitStatus).mockReturnValue({
      initialised: true, branch: 'main', branches: ['main'],
      remoteUrl: '', clean: true,
      staged: 0, modified: 0, untracked: 0, ahead: 0, behind: 0,
    });

    await gitCommand(['status', 'myapp', '--json']);
    const output = vi.mocked(process.stdout.write).mock.calls[0][0] as string;
    expect(JSON.parse(output).app).toBe('myapp');
  });
});
