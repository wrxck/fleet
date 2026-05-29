import { describe, it, expect, vi, beforeEach } from 'vitest';

// withRegistry wraps load() → mutate → save() under a file lock. the mock
// invokes the callback against the registry returned by load(), then calls
// save() with the result — matching the freeze/rollback test pattern.
vi.mock('../core/registry.js', () => ({
  load: vi.fn(),
  save: vi.fn(),
  findApp: vi.fn(),
  removeApp: vi.fn(),
  withRegistry: vi.fn(async (fn) => {
    const reg = (load as unknown as { (): unknown })();
    const next = await fn(reg);
    (save as unknown as { (r: unknown): void })(next);
  }),
}));

vi.mock('../core/systemd.js', () => ({
  stopService: vi.fn(),
  disableService: vi.fn(),
}));

import { load, save, findApp, removeApp } from '../core/registry';
import { stopService, disableService } from '../core/systemd';
import { removeCommand } from './remove';
import { makeMcpContext } from '../registry/context';
import type { AppEntry, Registry } from '../core/registry';

const mockLoad = vi.mocked(load);
const mockSave = vi.mocked(save);
const mockFindApp = vi.mocked(findApp);
const mockStopService = vi.mocked(stopService);
const mockDisableService = vi.mocked(disableService);
const mockRemoveApp = vi.mocked(removeApp);

function makeApp(overrides: Partial<AppEntry> = {}): AppEntry {
  return {
    name: 'web',
    displayName: 'Web',
    composePath: '/apps/web',
    composeFile: null,
    serviceName: 'fleet-web',
    domains: [],
    port: null,
    usesSharedDb: false,
    type: 'service',
    containers: ['web'],
    dependsOnDatabases: false,
    registeredAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function makeRegistry(app: AppEntry): Registry {
  return {
    version: 1,
    apps: [app],
    infrastructure: {
      databases: { serviceName: 'docker-databases', composePath: '/db' },
      nginx: { configPath: '/etc/nginx' },
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockStopService.mockReturnValue(true as never);
  mockDisableService.mockReturnValue(true as never);
});

describe('removeCommand — metadata', () => {
  it('has name "remove"', () => {
    expect(removeCommand.name).toBe('remove');
  });

  it('is marked destructive', () => {
    expect(removeCommand.destructive).toBeTruthy();
  });
});

describe('removeCommand run()', () => {
  it('returns { ok: false } for an unknown app and does not stop the service', async () => {
    const reg = makeRegistry(makeApp());
    mockLoad.mockReturnValue(reg);
    mockFindApp.mockReturnValue(undefined);

    const result = await removeCommand.run({ app: 'ghost', yes: true }, makeMcpContext(false));

    expect(result.ok).toBeFalsy();
    expect(result.summary).toMatch(/not found/i);
    expect(mockStopService).not.toHaveBeenCalled();
  });

  it('returns { ok: false, summary: /cancel/ } when confirmation is denied', async () => {
    const app = makeApp();
    const reg = makeRegistry(app);
    mockLoad.mockReturnValue(reg);
    mockFindApp.mockReturnValue(app);

    const result = await removeCommand.run({ app: 'web', yes: false }, makeMcpContext(false));

    expect(result.ok).toBeFalsy();
    expect(result.summary).toMatch(/cancel/i);
    expect(mockStopService).not.toHaveBeenCalled();
    expect(mockRemoveApp).not.toHaveBeenCalled();
  });

  it('stops, disables, removes app, and returns { ok: true } with yes: true', async () => {
    const app = makeApp();
    const reg = makeRegistry(app);
    mockLoad.mockReturnValue(reg);
    mockFindApp.mockReturnValue(app);
    mockRemoveApp.mockReturnValue({ ...reg, apps: [] } as never);

    const result = await removeCommand.run({ app: 'web', yes: true }, makeMcpContext(false));

    expect(mockStopService).toHaveBeenCalledWith('fleet-web');
    expect(mockDisableService).toHaveBeenCalledWith('fleet-web');
    expect(mockRemoveApp).toHaveBeenCalled();
    expect(mockSave).toHaveBeenCalled();
    expect(result.ok).toBeTruthy();
    expect(result.summary).toMatch(/removed/i);
    expect(result.data).toEqual({ app: 'web' });
  });

  it('returns { ok: false } when the app vanishes between the preview and the lock', async () => {
    const app = makeApp();
    mockLoad.mockReturnValue(makeRegistry(app));
    // resolves on the unlocked preview, gone on the in-lock re-resolve (toctou race).
    mockFindApp.mockReturnValueOnce(app).mockReturnValueOnce(undefined);

    const result = await removeCommand.run({ app: 'web', yes: true }, makeMcpContext(false));

    expect(result.ok).toBeFalsy();
    expect(mockRemoveApp).not.toHaveBeenCalled();
  });

  it('stops, disables, removes app, and returns { ok: true } when confirmation is granted', async () => {
    const app = makeApp();
    const reg = makeRegistry(app);
    mockLoad.mockReturnValue(reg);
    mockFindApp.mockReturnValue(app);
    mockRemoveApp.mockReturnValue({ ...reg, apps: [] } as never);

    const result = await removeCommand.run({ app: 'web', yes: false }, makeMcpContext(true));

    expect(mockStopService).toHaveBeenCalledWith('fleet-web');
    expect(mockDisableService).toHaveBeenCalledWith('fleet-web');
    expect(mockRemoveApp).toHaveBeenCalled();
    expect(result.ok).toBeTruthy();
    expect(result.summary).toMatch(/removed/i);
  });
});
