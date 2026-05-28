import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('node:fs', async () => {
  const actual = await vi.importActual<typeof import('node:fs')>('node:fs');
  return { ...actual, existsSync: vi.fn() };
});

vi.mock('../core/registry.js', async () => {
  const actual = await vi.importActual<typeof import('../core/registry')>('../core/registry.js');
  return {
    ...actual,
    addApp: vi.fn(),
    withRegistry: vi.fn(async (fn: (r: unknown) => unknown | Promise<unknown>) => {
      const mod = await vi.importMock<typeof import('../core/registry')>('../core/registry.js');
      const reg = (mod.load as unknown as { (): unknown })();
      await fn(reg);
    }),
  };
});

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

vi.mock('../core/validate.js', () => ({
  assertComposeFile: vi.fn(),
}));

import { existsSync } from 'node:fs';

import { addApp, withRegistry } from '../core/registry';
import { getContainersByCompose } from '../core/docker';
import { installServiceFile, readServiceFile, enableService } from '../core/systemd';
import { generateServiceFile } from '../templates/systemd';
import { makeMcpContext } from '../registry/context';
import { addCommand } from './add';

const mockExistsSync = vi.mocked(existsSync);
const mockAddApp = vi.mocked(addApp);
const mockGetContainers = vi.mocked(getContainersByCompose);
const mockReadServiceFile = vi.mocked(readServiceFile);
const mockInstallServiceFile = vi.mocked(installServiceFile);
const mockEnableService = vi.mocked(enableService);
const mockGenerateServiceFile = vi.mocked(generateServiceFile);

beforeEach(() => {
  vi.clearAllMocks();
  mockGetContainers.mockReturnValue(['myapp']);
  mockReadServiceFile.mockReturnValue(null);
  mockGenerateServiceFile.mockReturnValue('[Unit]\nDescription=test');
  mockExistsSync.mockImplementation((p: unknown) => {
    const path = String(p);
    return path === '/apps/myapp' || path.endsWith('docker-compose.yml');
  });
});

describe('addCommand — metadata', () => {
  it('has the correct name', () => {
    expect(addCommand.name).toBe('add');
  });

  it('is not marked destructive', () => {
    expect(addCommand.destructive).toBeFalsy();
  });
});

describe('addCommand — directory not found', () => {
  it('returns { ok: false } with a not-found summary when dir does not exist', async () => {
    mockExistsSync.mockReturnValue(false);
    const result = await addCommand.run(
      { dir: '/nonexistent/path', 'dry-run': false, yes: false },
      makeMcpContext(false),
    );
    expect(result.ok).toBeFalsy();
    expect(result.summary).toMatch(/not found/i);
    expect(result.data).toBeNull();
  });
});

describe('addCommand — no docker-compose found', () => {
  it('returns { ok: false } when directory exists but has no docker-compose', async () => {
    mockExistsSync.mockImplementation((p: unknown) => {
      // dir exists, but no docker-compose anywhere
      return String(p) === '/apps/myapp';
    });
    const result = await addCommand.run(
      { dir: '/apps/myapp', 'dry-run': false, yes: false },
      makeMcpContext(false),
    );
    expect(result.ok).toBeFalsy();
    expect(result.summary).toMatch(/docker-compose/i);
    expect(result.data).toBeNull();
  });
});

describe('addCommand — dry run', () => {
  it('returns { ok: true } with the assembled app but does NOT call addApp or installServiceFile', async () => {
    const result = await addCommand.run(
      { dir: '/apps/myapp', 'dry-run': true, yes: true },
      makeMcpContext(true),
    );
    expect(result.ok).toBeTruthy();
    expect(result.summary).toMatch(/dry run/i);
    expect(result.data).toBeTruthy();
    expect((result.data as { name: string }).name).toBe('myapp');
    expect(mockAddApp).not.toHaveBeenCalled();
    expect(mockInstallServiceFile).not.toHaveBeenCalled();
  });

  it('includes a keyValue render model in the dry-run result', async () => {
    const result = await addCommand.run(
      { dir: '/apps/myapp', 'dry-run': true, yes: false },
      makeMcpContext(false),
    );
    expect(result.render?.kind).toBe('keyValue');
  });
});

describe('addCommand — service-file confirm denied', () => {
  it('does not install service file when confirm is denied but still registers the app', async () => {
    // no existing service, confirm denied
    const result = await addCommand.run(
      { dir: '/apps/myapp', 'dry-run': false, yes: false },
      makeMcpContext(false),
    );
    expect(mockInstallServiceFile).not.toHaveBeenCalled();
    expect(mockAddApp).toHaveBeenCalled();
    expect(result.ok).toBeTruthy();
  });
});

describe('addCommand — happy path with yes: true', () => {
  it('installs the service file, enables it, and calls addApp', async () => {
    const result = await addCommand.run(
      { dir: '/apps/myapp', 'dry-run': false, yes: true },
      makeMcpContext(false),
    );
    expect(mockInstallServiceFile).toHaveBeenCalled();
    expect(mockEnableService).toHaveBeenCalled();
    expect(mockAddApp).toHaveBeenCalled();
    expect(result.ok).toBeTruthy();
    expect(result.summary).toMatch(/registered/i);
  });

  it('skips service install when service file already exists', async () => {
    mockReadServiceFile.mockReturnValue('[Unit]\nDescription=existing');
    const result = await addCommand.run(
      { dir: '/apps/myapp', 'dry-run': false, yes: true },
      makeMcpContext(false),
    );
    expect(mockInstallServiceFile).not.toHaveBeenCalled();
    expect(mockAddApp).toHaveBeenCalled();
    expect(result.ok).toBeTruthy();
  });

  it('sanitises the app name to alphanumeric-dash only', async () => {
    mockExistsSync.mockImplementation((p: unknown) => {
      const path = String(p);
      return path.includes('my_app') || path.endsWith('docker-compose.yml');
    });
    let capturedName: string | undefined;
    mockAddApp.mockImplementation((_reg, app) => {
      capturedName = (app as { name: string }).name;
      return _reg as never;
    });
    await addCommand.run(
      { dir: '/apps/my_app', 'dry-run': false, yes: true },
      makeMcpContext(false),
    );
    expect(capturedName).toMatch(/^[a-z0-9-]+$/);
  });
});

describe('addCommand — confirm via ctx.confirm', () => {
  it('installs service file when ctx.confirm resolves true (and yes: false)', async () => {
    const result = await addCommand.run(
      { dir: '/apps/myapp', 'dry-run': false, yes: false },
      makeMcpContext(true),
    );
    expect(mockInstallServiceFile).toHaveBeenCalled();
    expect(mockEnableService).toHaveBeenCalled();
    expect(result.ok).toBeTruthy();
  });
});
