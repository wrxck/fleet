import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../core/testflight/resolve.js', () => ({
  resolveTestflightTarget: vi.fn(),
  appSecretsEnv: vi.fn(),
}));
vi.mock('../core/testflight/credentials.js', () => ({
  resolveAscCredentials: vi.fn(() => ({ keyId: 'k', issuerId: 'i', privateKey: 'p' })),
  hasAscCredentials: vi.fn(),
  easEnv: vi.fn(),
}));
vi.mock('../core/testflight/eas.js', () => ({
  easVersion: vi.fn(),
  easBuild: vi.fn(),
  easSubmit: vi.fn(),
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
import { hasAscCredentials, easEnv } from '../core/testflight/credentials';
import { easVersion, easBuild, easSubmit } from '../core/testflight/eas';
import { listBuilds, expireBuild, setWhatsNew } from '../core/testflight/asc';

const mockResolve = vi.mocked(resolveTestflightTarget);
const mockEnv = vi.mocked(appSecretsEnv);
const mockHasCreds = vi.mocked(hasAscCredentials);
const mockEasEnv = vi.mocked(easEnv);
const mockEasVersion = vi.mocked(easVersion);
const mockEasBuild = vi.mocked(easBuild);
const mockEasSubmit = vi.mocked(easSubmit);
const mockListBuilds = vi.mocked(listBuilds);
const mockExpire = vi.mocked(expireBuild);
const mockWhatsNew = vi.mocked(setWhatsNew);

beforeEach(() => {
  vi.clearAllMocks();
  mockResolve.mockReturnValue({ app: 'shiftfaced', projectPath: '/p/mobile' });
  mockEnv.mockReturnValue({ ASC_APP_ID: 'asc1', EXPO_TOKEN: 'tok' });
  mockHasCreds.mockReturnValue(true);
  mockEasEnv.mockReturnValue({ EXPO_TOKEN: 'tok' });
  mockEasVersion.mockReturnValue('eas-cli/18.0.0');
  mockListBuilds.mockResolvedValue([]);
  mockEasBuild.mockReturnValue(0);
  mockEasSubmit.mockReturnValue(0);
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
    mockEnv.mockReturnValue({ EXPO_TOKEN: 'tok' });
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
  it('builds then submits when credentials are present', async () => {
    const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    await testflightCommand(['publish', 'shiftfaced']);
    expect(mockEasBuild).toHaveBeenCalledWith('/p/mobile', 'production', { EXPO_TOKEN: 'tok' });
    expect(mockEasSubmit).toHaveBeenCalledWith('/p/mobile', 'production', { EXPO_TOKEN: 'tok' });
    writeSpy.mockRestore();
  });

  it('skips the build with --no-build', async () => {
    const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    await testflightCommand(['publish', 'shiftfaced', '--no-build']);
    expect(mockEasBuild).not.toHaveBeenCalled();
    expect(mockEasSubmit).toHaveBeenCalled();
    writeSpy.mockRestore();
  });

  it('exits when EXPO_TOKEN is missing', async () => {
    mockEasEnv.mockReturnValue({});
    const exit = exitGuard();
    await expect(testflightCommand(['publish', 'shiftfaced'])).rejects.toThrow('exit');
    exit.mockRestore();
  });
});

describe('testflight doctor', () => {
  it('reports readiness without throwing', async () => {
    await testflightCommand(['doctor', 'shiftfaced']);
    expect(mockEasVersion).toHaveBeenCalled();
  });
});
