import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('node:fs', async () => {
  const actual = await vi.importActual<typeof import('node:fs')>('node:fs');
  return { ...actual, existsSync: vi.fn() };
});

vi.mock('../core/registry.js', () => ({
  load: vi.fn(),
  save: vi.fn(),
  addApp: vi.fn(),
}));

vi.mock('../core/docker.js', () => ({
  getContainersByCompose: vi.fn(),
}));

vi.mock('../core/systemd.js', () => ({
  installServiceFile: vi.fn(),
  readServiceFile: vi.fn(),
  enableService: vi.fn(),
}));

vi.mock('../templates/systemd.js', () => ({
  generateServiceFile: vi.fn(),
}));

vi.mock('../ui/output.js', () => ({
  success: vi.fn(),
  info: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
}));

vi.mock('../ui/confirm.js', () => ({
  confirm: vi.fn(),
}));

import { existsSync } from 'node:fs';
import { addCommand } from './add.js';
import { load, save, addApp } from '../core/registry.js';
import { getContainersByCompose } from '../core/docker.js';
import { installServiceFile, readServiceFile, enableService } from '../core/systemd.js';
import { generateServiceFile } from '../templates/systemd.js';
import { confirm } from '../ui/confirm.js';

const mockExistsSync = vi.mocked(existsSync);
const mockLoad = vi.mocked(load);
const mockSave = vi.mocked(save);
const mockAddApp = vi.mocked(addApp);
const mockGetContainers = vi.mocked(getContainersByCompose);
const mockReadServiceFile = vi.mocked(readServiceFile);
const mockInstallServiceFile = vi.mocked(installServiceFile);
const mockEnableService = vi.mocked(enableService);
const mockGenerateServiceFile = vi.mocked(generateServiceFile);
const mockConfirm = vi.mocked(confirm);

function makeRegistry() {
  return {
    version: 1,
    apps: [],
    infrastructure: {
      databases: { serviceName: 'docker-databases', composePath: '/db' },
      nginx: { configPath: '/etc/nginx' },
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockLoad.mockReturnValue(makeRegistry());
  mockAddApp.mockImplementation((_reg, app) => ({ ...makeRegistry(), apps: [app] }));
  mockGetContainers.mockReturnValue(['myapp']);
  mockReadServiceFile.mockReturnValue(null);
  mockGenerateServiceFile.mockReturnValue('[Unit]\nDescription=test');
  mockConfirm.mockResolvedValue(true);
  mockExistsSync.mockImplementation((p: unknown) => {
    const path = String(p);
    return path === '/apps/myapp' || path.endsWith('docker-compose.yml');
  });
});

describe('addCommand — argument validation', () => {
  it('exits when no app-dir given', async () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    await expect(addCommand([])).rejects.toThrow('exit');
    exitSpy.mockRestore();
  });

  it('throws FleetError when directory does not exist', async () => {
    mockExistsSync.mockReturnValue(false);
    await expect(addCommand(['/nonexistent/path'])).rejects.toThrow('Directory not found');
  });

  it('throws FleetError when no docker-compose.yml found', async () => {
    mockExistsSync.mockImplementation((p: unknown) => {
      const path = String(p);
      return path === '/apps/myapp';
    });
    await expect(addCommand(['/apps/myapp'])).rejects.toThrow('No docker-compose.yml');
  });
});

describe('addCommand — dry run', () => {
  it('does not save registry in dry run', async () => {
    await addCommand(['/apps/myapp', '--dry-run']);
    expect(mockSave).not.toHaveBeenCalled();
  });

  it('writes app JSON to stdout in dry run', async () => {
    const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    await addCommand(['/apps/myapp', '--dry-run']);
    expect(writeSpy).toHaveBeenCalledWith(expect.stringContaining('"name"'));
    writeSpy.mockRestore();
  });
});

describe('addCommand — service creation', () => {
  it('creates service when none exists and user confirms', async () => {
    await addCommand(['/apps/myapp', '-y']);
    expect(mockInstallServiceFile).toHaveBeenCalled();
    expect(mockEnableService).toHaveBeenCalled();
  });

  it('skips service creation when service already exists', async () => {
    mockReadServiceFile.mockReturnValue('[Unit]\nDescription=existing');
    await addCommand(['/apps/myapp', '-y']);
    expect(mockInstallServiceFile).not.toHaveBeenCalled();
  });

  it('skips service creation when user declines confirm', async () => {
    mockConfirm.mockResolvedValue(false);
    await addCommand(['/apps/myapp']);
    expect(mockInstallServiceFile).not.toHaveBeenCalled();
  });

  it('saves registry after successful add', async () => {
    await addCommand(['/apps/myapp', '-y']);
    expect(mockSave).toHaveBeenCalled();
  });
});

describe('addCommand — security: input validation', () => {
  it('handles directory not existing for path traversal attempt', async () => {
    mockExistsSync.mockReturnValue(false);
    await expect(addCommand(['../../etc/passwd'])).rejects.toThrow('Directory not found');
  });

  it('sanitizes app name from directory basename to alphanumeric-dash only', async () => {
    mockExistsSync.mockImplementation((p: unknown) => {
      const path = String(p);
      return path.includes('my_app') || path.endsWith('docker-compose.yml');
    });
    let capturedApp: { name: string } | undefined;
    mockAddApp.mockImplementation((_r, app) => { capturedApp = app as { name: string }; return makeRegistry(); });
    await addCommand(['/apps/my_app', '-y']);
    expect(capturedApp?.name).toMatch(/^[a-z0-9-]+$/);
  });

  it('does not call installServiceFile in dry run even when confirming', async () => {
    await addCommand(['/apps/myapp', '--dry-run', '-y']);
    expect(mockInstallServiceFile).not.toHaveBeenCalled();
  });
});
