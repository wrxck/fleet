import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('node:fs', async () => {
  const actual = await vi.importActual<typeof import('node:fs')>('node:fs');
  return { ...actual, existsSync: vi.fn() };
});

vi.mock('../core/registry.js', () => ({
  load: vi.fn(),
  save: vi.fn(),
  findApp: vi.fn(),
}));

vi.mock('../core/docker.js', () => ({
  composeBuild: vi.fn(),
  composeUp: vi.fn(),
  composeDown: vi.fn(),
}));

vi.mock('../core/systemd.js', () => ({
  startService: vi.fn(),
  restartService: vi.fn(),
  getServiceStatus: vi.fn(),
}));

vi.mock('../ui/output.js', () => ({
  success: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  heading: vi.fn(),
}));

vi.mock('./add.js', () => ({
  addCommand: vi.fn(),
}));

import { existsSync } from 'node:fs';
import { deployCommand } from './deploy.js';
import { load, save } from '../core/registry.js';
import { composeBuild } from '../core/docker.js';
import { startService, restartService, getServiceStatus } from '../core/systemd.js';
import { addCommand } from './add.js';

const mockExistsSync = vi.mocked(existsSync);
const mockLoad = vi.mocked(load);
const mockComposeBuild = vi.mocked(composeBuild);
const mockStartService = vi.mocked(startService);
const mockRestartService = vi.mocked(restartService);
const mockGetServiceStatus = vi.mocked(getServiceStatus);
const mockAddCommand = vi.mocked(addCommand);

function makeApp(overrides = {}) {
  return {
    name: 'myapp',
    displayName: 'My App',
    composePath: '/apps/myapp',
    composeFile: null,
    serviceName: 'myapp',
    domains: [],
    port: null,
    usesSharedDb: false,
    type: 'service',
    containers: ['myapp'],
    dependsOnDatabases: false,
    registeredAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function makeRegistry(apps = [makeApp()]) {
  return {
    version: 1,
    apps,
    infrastructure: {
      databases: { serviceName: 'docker-databases', composePath: '/db' },
      nginx: { configPath: '/etc/nginx' },
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockExistsSync.mockReturnValue(true);
  mockLoad.mockReturnValue(makeRegistry());
  mockComposeBuild.mockReturnValue(true);
  mockStartService.mockReturnValue(true);
  mockRestartService.mockReturnValue(true);
  mockGetServiceStatus.mockReturnValue({ state: 'inactive', active: false });
  mockAddCommand.mockResolvedValue(undefined);
});

describe('deployCommand — argument validation', () => {
  it('exits when no app-dir given', async () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    await expect(deployCommand([])).rejects.toThrow('exit');
    exitSpy.mockRestore();
  });

  it('throws FleetError when directory does not exist', async () => {
    mockExistsSync.mockReturnValue(false);
    await expect(deployCommand(['/nonexistent'])).rejects.toThrow('Directory not found');
  });
});

describe('deployCommand — app not registered', () => {
  it('calls addCommand if app not in registry', async () => {
    mockLoad
      .mockReturnValueOnce(makeRegistry([]))
      .mockReturnValueOnce(makeRegistry([makeApp()]));
    await deployCommand(['/apps/myapp', '-y']);
    expect(mockAddCommand).toHaveBeenCalled();
  });

  it('throws if add fails to register app', async () => {
    mockLoad.mockReturnValue(makeRegistry([]));
    mockAddCommand.mockResolvedValue(undefined);
    await expect(deployCommand(['/apps/myapp', '-y'])).rejects.toThrow('Failed to register app');
  });
});

describe('deployCommand — dry run', () => {
  it('skips build and service in dry run', async () => {
    await deployCommand(['/apps/myapp', '--dry-run', '-y']);
    expect(mockComposeBuild).not.toHaveBeenCalled();
    expect(mockStartService).not.toHaveBeenCalled();
    expect(mockRestartService).not.toHaveBeenCalled();
  });
});

describe('deployCommand — build and start', () => {
  it('exits when build fails', async () => {
    mockComposeBuild.mockReturnValue(false);
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    await expect(deployCommand(['/apps/myapp', '-y'])).rejects.toThrow('exit');
    exitSpy.mockRestore();
  });

  it('starts service when not active', async () => {
    mockGetServiceStatus.mockReturnValue({ state: 'inactive', active: false });
    await deployCommand(['/apps/myapp', '-y']);
    expect(mockStartService).toHaveBeenCalledWith('myapp');
  });

  it('restarts service when already active', async () => {
    mockGetServiceStatus.mockReturnValue({ state: 'active', active: true });
    await deployCommand(['/apps/myapp', '-y']);
    expect(mockRestartService).toHaveBeenCalledWith('myapp');
  });

  it('exits when service start fails', async () => {
    mockStartService.mockReturnValue(false);
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    await expect(deployCommand(['/apps/myapp', '-y'])).rejects.toThrow('exit');
    exitSpy.mockRestore();
  });
});

describe('deployCommand — security', () => {
  it('throws for path traversal in app-dir', async () => {
    mockExistsSync.mockReturnValue(false);
    await expect(deployCommand(['../../etc/cron.d/evil'])).rejects.toThrow('Directory not found');
  });
});
