import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./git.js', () => ({
  ensureGitignore: vi.fn().mockReturnValue('created .gitignore'),
  gitInit: vi.fn(),
  gitAdd: vi.fn(),
  gitCommit: vi.fn(),
  gitCheckout: vi.fn(),
  gitPush: vi.fn(),
  gitPushAll: vi.fn(),
  gitAddRemote: vi.fn(),
  gitSetRemoteUrl: vi.fn(),
  branchExists: vi.fn().mockReturnValue(false),
  hasCommits: vi.fn().mockReturnValue(true),
  getGitStatus: vi.fn(),
}));

vi.mock('./github.js', () => ({
  GITHUB_ORG: 'wrxck',
  getRepoUrl: vi.fn().mockImplementation((name: string) => `git@github.com:wrxck/${name}.git`),
  createRepo: vi.fn(),
  protectBranch: vi.fn().mockReturnValue(true),
}));

vi.mock('./registry.js', () => ({
  load: vi.fn().mockReturnValue({ apps: [] }),
  findApp: vi.fn().mockReturnValue(null),
  save: vi.fn(),
}));

import { detectScenario, describeOnboardPlan, executeOnboard } from './git-onboard.js';
import type { OnboardScenario } from './git-onboard.js';
import type { GitStatus } from './git.js';

function makeStatus(overrides: Partial<GitStatus> = {}): GitStatus {
  return {
    initialised: true,
    clean: true,
    branch: 'main',
    remoteUrl: null,
    hasUnpushed: false,
    ...overrides,
  };
}

describe('detectScenario', () => {
  it('returns fresh when git not initialised', () => {
    expect(detectScenario(makeStatus({ initialised: false }))).toBe('fresh');
  });

  it('returns resume when remote URL is on the configured org', () => {
    expect(detectScenario(makeStatus({ remoteUrl: 'git@github.com:wrxck/myapp.git' }))).toBe('resume');
  });

  it('returns migrate when remote URL is on a different org', () => {
    expect(detectScenario(makeStatus({ remoteUrl: 'git@github.com:heskethwebdesign/myapp.git' }))).toBe('migrate');
  });

  it('returns no-remote when initialised but no remote', () => {
    expect(detectScenario(makeStatus({ remoteUrl: null }))).toBe('no-remote');
  });

  it('returns migrate when remote is on an unrelated org', () => {
    expect(detectScenario(makeStatus({ remoteUrl: 'git@github.com:other/myapp.git' }))).toBe('migrate');
  });
});

describe('describeOnboardPlan', () => {
  const status = makeStatus();

  it('fresh plan includes git init and initial commit', () => {
    const steps = describeOnboardPlan('fresh', 'myapp', status);
    expect(steps.join(' ')).toContain('git init');
    expect(steps.join(' ')).toContain('initial commit');
  });

  it('fresh plan includes repo creation step', () => {
    const steps = describeOnboardPlan('fresh', 'myapp', status);
    expect(steps.join(' ')).toContain('myapp');
  });

  it('migrate plan includes remote set-url', () => {
    const steps = describeOnboardPlan('migrate', 'myapp', status);
    expect(steps.join(' ')).toContain('remote set-url');
  });

  it('no-remote plan includes add remote', () => {
    const steps = describeOnboardPlan('no-remote', 'myapp', status);
    expect(steps.join(' ')).toContain('add remote');
  });

  it('resume plan includes push branches', () => {
    const steps = describeOnboardPlan('resume', 'myapp', status);
    expect(steps.join(' ')).toContain('push');
  });

  it('all scenarios include protect branches step', () => {
    const scenarios: OnboardScenario[] = ['fresh', 'migrate', 'no-remote', 'resume'];
    for (const s of scenarios) {
      const steps = describeOnboardPlan(s, 'myapp', status);
      expect(steps.join(' ')).toContain('protect');
    }
  });

  it('all scenarios update fleet registry', () => {
    const scenarios: OnboardScenario[] = ['fresh', 'migrate', 'no-remote', 'resume'];
    for (const s of scenarios) {
      const steps = describeOnboardPlan(s, 'myapp', status);
      expect(steps.join(' ')).toContain('registry');
    }
  });
});

describe('executeOnboard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns result with scenario, steps, repoUrl, branches', () => {
    const result = executeOnboard('fresh', '/app', 'myapp', 'myapp', makeStatus({ initialised: false }));
    expect(result.scenario).toBe('fresh');
    expect(Array.isArray(result.steps)).toBe(true);
    expect(result.repoUrl).toContain('myapp');
    expect(result.branches).toContain('main');
    expect(result.branches).toContain('develop');
  });

  it('fresh scenario initialises git and commits', async () => {
    const { gitInit, gitAdd, gitCommit } = await import('./git.js');
    executeOnboard('fresh', '/app', 'myapp', 'myapp', makeStatus({ initialised: false }));
    expect(gitInit).toHaveBeenCalledWith('/app');
    expect(gitAdd).toHaveBeenCalled();
    expect(gitCommit).toHaveBeenCalledWith('/app', 'Initial commit');
  });

  it('migrate scenario sets remote URL', async () => {
    const { gitSetRemoteUrl, gitPushAll } = await import('./git.js');
    executeOnboard('migrate', '/app', 'myapp', 'myapp', makeStatus());
    expect(gitSetRemoteUrl).toHaveBeenCalled();
    expect(gitPushAll).toHaveBeenCalled();
  });

  it('no-remote scenario commits outstanding changes when dirty', async () => {
    const { gitAdd, gitCommit } = await import('./git.js');
    executeOnboard('no-remote', '/app', 'myapp', 'myapp', makeStatus({ clean: false }));
    expect(gitAdd).toHaveBeenCalled();
    expect(gitCommit).toHaveBeenCalledWith('/app', 'Pre-onboard commit');
  });

  it('resume scenario pushes existing commits', async () => {
    const { gitPushAll, hasCommits } = await import('./git.js');
    (hasCommits as ReturnType<typeof vi.fn>).mockReturnValue(true);
    executeOnboard('resume', '/app', 'myapp', 'myapp', makeStatus());
    expect(gitPushAll).toHaveBeenCalled();
  });
});
