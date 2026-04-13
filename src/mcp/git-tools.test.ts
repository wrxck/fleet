import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../core/registry.js', () => ({
  load: vi.fn(),
  findApp: vi.fn(),
}));

vi.mock('../core/git.js', () => ({
  getGitStatus: vi.fn(),
  getProjectRoot: vi.fn(),
  gitAddTracked: vi.fn(),
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

import { load, findApp } from '../core/registry.js';
import { getGitStatus, getProjectRoot } from '../core/git.js';
import { registerGitTools } from './git-tools.js';

beforeEach(() => vi.clearAllMocks());

describe('registerGitTools', () => {
  it('registers all git tools on the server', () => {
    const server = { tool: vi.fn() };
    registerGitTools(server as any);

    const toolNames = server.tool.mock.calls.map((c: any[]) => c[0]);
    expect(toolNames).toContain('fleet_git_status');
    expect(toolNames).toContain('fleet_git_onboard');
    expect(toolNames).toContain('fleet_git_commit');
    expect(toolNames).toContain('fleet_git_push');
    expect(toolNames).toContain('fleet_git_pr_create');
    expect(toolNames).toContain('fleet_git_pr_list');
  });

  it('fleet_git_status returns status for all apps', async () => {
    const server = { tool: vi.fn() };
    registerGitTools(server as any);

    const statusCall = server.tool.mock.calls.find((c: any[]) => c[0] === 'fleet_git_status');
    const handler = statusCall[statusCall.length - 1];

    vi.mocked(load).mockReturnValue({ apps: [] } as any);
    const result = await handler({ app: undefined });
    expect(result.content[0].text).toContain('[]');
  });

  it('fleet_git_status returns status for single app', async () => {
    const server = { tool: vi.fn() };
    registerGitTools(server as any);

    const statusCall = server.tool.mock.calls.find((c: any[]) => c[0] === 'fleet_git_status');
    const handler = statusCall[statusCall.length - 1];

    const app = { name: 'myapp', composePath: '/opt/myapp', gitOnboardedAt: '2026-01-01' };
    vi.mocked(load).mockReturnValue({ apps: [app] } as any);
    vi.mocked(findApp).mockReturnValue(app as any);
    vi.mocked(getProjectRoot).mockReturnValue('/opt/myapp');
    vi.mocked(getGitStatus).mockReturnValue({
      initialised: true, branch: 'main', branches: ['main'],
      remoteUrl: '', clean: true, staged: 0, modified: 0, untracked: 0, ahead: 0, behind: 0,
    });

    const result = await handler({ app: 'myapp' });
    expect(result.content[0].text).toContain('myapp');
  });

  it('throws AppNotFoundError for unknown app', async () => {
    const server = { tool: vi.fn() };
    registerGitTools(server as any);

    const statusCall = server.tool.mock.calls.find((c: any[]) => c[0] === 'fleet_git_status');
    const handler = statusCall[statusCall.length - 1];

    vi.mocked(load).mockReturnValue({ apps: [] } as any);
    vi.mocked(findApp).mockReturnValue(undefined as any);

    await expect(handler({ app: 'nonexistent' })).rejects.toThrow();
  });
});
