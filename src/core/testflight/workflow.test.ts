import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../exec.js', () => ({ execSafe: vi.fn(), execLive: vi.fn() }));

import { execSafe, execLive } from '../exec';
import {
  ghVersion, resolveRepo, repoSecrets, dispatchWorkflow, latestRun, watchRun,
} from './workflow';

const mockExec = vi.mocked(execSafe);
const mockLive = vi.mocked(execLive);

function ok(stdout: string) {
  return { stdout, stderr: '', exitCode: 0, ok: true };
}
function fail(stderr = 'boom') {
  return { stdout: '', stderr, exitCode: 1, ok: false };
}

beforeEach(() => vi.clearAllMocks());

describe('ghVersion', () => {
  it('returns the first line of gh --version', () => {
    mockExec.mockReturnValue(ok('gh version 2.40.0 (2024-01-01)\nhttps://github.com/cli/cli'));
    expect(ghVersion()).toBe('gh version 2.40.0 (2024-01-01)');
  });

  it('returns null when gh is not installed', () => {
    mockExec.mockReturnValue(fail());
    expect(ghVersion()).toBeNull();
  });
});

describe('resolveRepo', () => {
  it('returns the owner/name of the repo', () => {
    mockExec.mockReturnValue(ok('wrxck/shiftfaced'));
    expect(resolveRepo('/p/mobile')).toBe('wrxck/shiftfaced');
    expect(mockExec).toHaveBeenCalledWith(
      'gh',
      ['repo', 'view', '--json', 'nameWithOwner', '-q', '.nameWithOwner'],
      expect.objectContaining({ cwd: '/p/mobile' }),
    );
  });

  it('returns null outside a github checkout', () => {
    mockExec.mockReturnValue(fail('no git remotes found'));
    expect(resolveRepo('/tmp')).toBeNull();
  });
});

describe('repoSecrets', () => {
  it('parses the secret names from the first column', () => {
    mockExec.mockReturnValue(ok('ASC_API_KEY_ID\t2026-05-01\nAPPLE_TEAM_ID\t2026-05-02'));
    expect(repoSecrets('wrxck/shiftfaced')).toEqual(['ASC_API_KEY_ID', 'APPLE_TEAM_ID']);
  });

  it('returns null when the listing fails', () => {
    mockExec.mockReturnValue(fail());
    expect(repoSecrets('wrxck/shiftfaced')).toBeNull();
  });
});

describe('dispatchWorkflow', () => {
  it('runs gh workflow run with the ref when given', () => {
    mockExec.mockReturnValue(ok(''));
    const res = dispatchWorkflow('wrxck/shiftfaced', 'ios-testflight.yml', 'develop');
    expect(res.ok).toBe(true);
    expect(mockExec).toHaveBeenCalledWith(
      'gh',
      ['workflow', 'run', 'ios-testflight.yml', '--repo', 'wrxck/shiftfaced', '--ref', 'develop'],
      expect.anything(),
    );
  });

  it('omits --ref when no ref is given', () => {
    mockExec.mockReturnValue(ok(''));
    dispatchWorkflow('wrxck/shiftfaced', 'ios-testflight.yml');
    expect(mockExec).toHaveBeenCalledWith(
      'gh',
      ['workflow', 'run', 'ios-testflight.yml', '--repo', 'wrxck/shiftfaced'],
      expect.anything(),
    );
  });

  it('surfaces the stderr on failure', () => {
    mockExec.mockReturnValue(fail('could not find any workflows'));
    const res = dispatchWorkflow('wrxck/shiftfaced', 'missing.yml');
    expect(res.ok).toBe(false);
    expect(res.message).toBe('could not find any workflows');
  });
});

describe('latestRun', () => {
  it('returns the most recent run', () => {
    mockExec.mockReturnValue(ok(JSON.stringify([
      { databaseId: 9, status: 'in_progress', conclusion: null, url: 'u', createdAt: 't' },
    ])));
    expect(latestRun('wrxck/shiftfaced', 'ios-testflight.yml')?.databaseId).toBe(9);
  });

  it('returns null when there are no runs', () => {
    mockExec.mockReturnValue(ok('[]'));
    expect(latestRun('wrxck/shiftfaced', 'ios-testflight.yml')).toBeNull();
  });

  it('returns null on malformed json', () => {
    mockExec.mockReturnValue(ok('not json'));
    expect(latestRun('wrxck/shiftfaced', 'ios-testflight.yml')).toBeNull();
  });
});

describe('watchRun', () => {
  it('streams the run and returns the exit code', () => {
    mockLive.mockReturnValue(0);
    expect(watchRun('wrxck/shiftfaced', 42)).toBe(0);
    expect(mockLive).toHaveBeenCalledWith(
      'gh',
      ['run', 'watch', '42', '--repo', 'wrxck/shiftfaced', '--exit-status'],
    );
  });
});
