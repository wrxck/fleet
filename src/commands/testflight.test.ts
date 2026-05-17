import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../core/testflight/resolve.js', () => ({
  resolveTestflightTarget: vi.fn(),
  appSecretsEnv: vi.fn(),
}));
vi.mock('../core/testflight/credentials.js', () => ({
  resolveAscCredentials: vi.fn(() => ({ keyId: 'k', issuerId: 'i', privateKey: 'p' })),
  hasAscCredentials: vi.fn(),
}));
vi.mock('../core/testflight/workflow.js', () => ({
  ghVersion: vi.fn(),
  resolveRepo: vi.fn(),
  repoSecrets: vi.fn(),
  dispatchWorkflow: vi.fn(),
  latestRun: vi.fn(),
  watchRun: vi.fn(),
}));
vi.mock('../core/testflight/asc.js', () => ({
  listBuilds: vi.fn(),
  expireBuild: vi.fn(),
  setWhatsNew: vi.fn(),
  verifyApp: vi.fn(),
}));
vi.mock('../ui/output.js', () => ({
  heading: vi.fn(), success: vi.fn(), error: vi.fn(),
  info: vi.fn(), warn: vi.fn(), table: vi.fn(),
}));

import { testflightCommand } from './testflight';
import { resolveTestflightTarget, appSecretsEnv } from '../core/testflight/resolve';
import { hasAscCredentials } from '../core/testflight/credentials';
import {
  ghVersion, resolveRepo, repoSecrets, dispatchWorkflow, latestRun, watchRun,
} from '../core/testflight/workflow';
import { listBuilds, expireBuild, setWhatsNew } from '../core/testflight/asc';

const mockResolve = vi.mocked(resolveTestflightTarget);
const mockEnv = vi.mocked(appSecretsEnv);
const mockHasCreds = vi.mocked(hasAscCredentials);
const mockGhVersion = vi.mocked(ghVersion);
const mockResolveRepo = vi.mocked(resolveRepo);
const mockRepoSecrets = vi.mocked(repoSecrets);
const mockDispatch = vi.mocked(dispatchWorkflow);
const mockLatestRun = vi.mocked(latestRun);
const mockWatchRun = vi.mocked(watchRun);
const mockListBuilds = vi.mocked(listBuilds);
const mockExpire = vi.mocked(expireBuild);
const mockWhatsNew = vi.mocked(setWhatsNew);

function run(databaseId: number) {
  return {
    databaseId,
    status: 'queued',
    conclusion: null,
    url: `https://github.com/wrxck/shiftfaced/actions/runs/${databaseId}`,
    createdAt: '2026-05-17T00:00:00Z',
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockResolve.mockReturnValue({ app: 'shiftfaced', projectPath: '/p/mobile' });
  mockEnv.mockReturnValue({ ASC_APP_ID: 'asc1' });
  mockHasCreds.mockReturnValue(true);
  mockGhVersion.mockReturnValue('gh version 2.40.0');
  mockResolveRepo.mockReturnValue('wrxck/shiftfaced');
  mockRepoSecrets.mockReturnValue([
    'ASC_API_KEY_ID', 'ASC_API_KEY_ISSUER_ID', 'ASC_API_KEY_B64', 'APPLE_TEAM_ID',
  ]);
  mockDispatch.mockReturnValue({ ok: true, message: 'dispatched' });
  // the first call is the "before" snapshot; every later call resolves the
  // run the dispatch created — a distinct id, so the poll loop exits at once.
  mockLatestRun.mockImplementation(() =>
    mockLatestRun.mock.calls.length <= 1 ? run(1) : run(2),
  );
  mockWatchRun.mockReturnValue(0);
  mockListBuilds.mockResolvedValue([]);
});

function exitGuard() {
  return vi.spyOn(process, 'exit').mockImplementation(() => {
    throw new Error('exit');
  });
}

describe('testflightCommand routing', () => {
  it('exits on an unknown subcommand', async () => {
    const exit = exitGuard();
    await expect(testflightCommand(['frobnicate'])).rejects.toThrow('exit');
    exit.mockRestore();
  });
});

describe('testflight builds', () => {
  it('lists builds for an app', async () => {
    const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    await testflightCommand(['builds', 'shiftfaced']);
    expect(mockListBuilds).toHaveBeenCalledWith(
      { keyId: 'k', issuerId: 'i', privateKey: 'p' }, 'asc1',
    );
    writeSpy.mockRestore();
  });

  it('exits when no ASC app id is available', async () => {
    mockEnv.mockReturnValue({});
    const exit = exitGuard();
    await expect(testflightCommand(['builds', 'shiftfaced'])).rejects.toThrow('exit');
    exit.mockRestore();
  });
});

describe('testflight update', () => {
  it('sets the build test notes', async () => {
    await testflightCommand([
      'update', 'shiftfaced', '--build', 'b1', '--whats-new', 'fixed login',
    ]);
    expect(mockWhatsNew).toHaveBeenCalledWith(
      { keyId: 'k', issuerId: 'i', privateKey: 'p' }, 'b1', 'fixed login',
    );
  });

  it('exits when --whats-new is missing', async () => {
    const exit = exitGuard();
    await expect(
      testflightCommand(['update', 'shiftfaced', '--build', 'b1']),
    ).rejects.toThrow('exit');
    exit.mockRestore();
  });
});

describe('testflight delete', () => {
  it('expires the build', async () => {
    await testflightCommand(['delete', 'shiftfaced', '--build', 'b9']);
    expect(mockExpire).toHaveBeenCalledWith(
      { keyId: 'k', issuerId: 'i', privateKey: 'p' }, 'b9',
    );
  });
});

describe('testflight publish', () => {
  it('dispatches the build workflow', async () => {
    await testflightCommand(['publish', 'shiftfaced']);
    expect(mockDispatch).toHaveBeenCalledWith('wrxck/shiftfaced', 'ios-testflight.yml', undefined);
  });

  it('passes a --ref through to the dispatch', async () => {
    await testflightCommand(['publish', 'shiftfaced', '--ref', 'develop']);
    expect(mockDispatch).toHaveBeenCalledWith('wrxck/shiftfaced', 'ios-testflight.yml', 'develop');
  });

  it('watches the run when --watch is passed', async () => {
    await testflightCommand(['publish', 'shiftfaced', '--watch']);
    expect(mockWatchRun).toHaveBeenCalledWith('wrxck/shiftfaced', 2);
  });

  it('exits when the GitHub CLI is missing', async () => {
    mockGhVersion.mockReturnValue(null);
    const exit = exitGuard();
    await expect(testflightCommand(['publish', 'shiftfaced'])).rejects.toThrow('exit');
    expect(mockDispatch).not.toHaveBeenCalled();
    exit.mockRestore();
  });

  it('exits when the repo cannot be resolved', async () => {
    mockResolveRepo.mockReturnValue(null);
    const exit = exitGuard();
    await expect(testflightCommand(['publish', 'shiftfaced'])).rejects.toThrow('exit');
    expect(mockDispatch).not.toHaveBeenCalled();
    exit.mockRestore();
  });

  it('exits when the dispatch fails', async () => {
    mockDispatch.mockReturnValue({ ok: false, message: 'no such workflow' });
    const exit = exitGuard();
    await expect(testflightCommand(['publish', 'shiftfaced'])).rejects.toThrow('exit');
    exit.mockRestore();
  });
});

describe('testflight doctor', () => {
  it('reports readiness without throwing', async () => {
    await testflightCommand(['doctor', 'shiftfaced']);
    expect(mockGhVersion).toHaveBeenCalled();
    expect(mockResolveRepo).toHaveBeenCalled();
  });
});
