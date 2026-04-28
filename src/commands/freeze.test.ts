import { describe, it, expect, vi, beforeEach } from 'vitest';

// withRegistry wraps load() → mutate → save() under a file lock. For tests we
// don't want real I/O, so we stub it to call the mutator against the registry
// the test set up via mockLoad, then call mockSave with the result. That keeps
// the existing mocked-load/save assertions working.
vi.mock('../core/registry.js', () => ({
  load: vi.fn(),
  save: vi.fn(),
  findApp: vi.fn(),
  withRegistry: vi.fn(async (fn) => {
    const reg = (load as unknown as { (): unknown })();
    const next = await fn(reg);
    (save as unknown as { (r: unknown): void })(next);
  }),
}));

vi.mock('../core/systemd.js', () => ({
  stopService: vi.fn(),
  startService: vi.fn(),
  enableService: vi.fn(),
  disableService: vi.fn(),
}));

vi.mock('../ui/output.js', () => ({
  success: vi.fn(),
  error: vi.fn(),
}));

import { load, save, findApp } from '../core/registry.js';
import { stopService, startService, enableService, disableService } from '../core/systemd.js';
import { freezeApp, unfreezeApp } from './freeze.js';
import { AppNotFoundError } from '../core/errors.js';
import type { AppEntry, Registry } from '../core/registry.js';

const mockLoad = vi.mocked(load);
const mockSave = vi.mocked(save);
const mockFindApp = vi.mocked(findApp);
const mockStopService = vi.mocked(stopService);
const mockStartService = vi.mocked(startService);
const mockEnableService = vi.mocked(enableService);
const mockDisableService = vi.mocked(disableService);

function makeApp(overrides: Partial<AppEntry> = {}): AppEntry {
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
  mockStopService.mockReturnValue(true);
  mockDisableService.mockReturnValue(true);
  mockEnableService.mockReturnValue(true);
  mockStartService.mockReturnValue(true);
});

describe('freezeApp', () => {
  it('stops, disables, sets frozen fields, and saves', async () => {
    const app = makeApp();
    const reg = makeRegistry(app);
    mockLoad.mockReturnValue(reg);
    mockFindApp.mockReturnValue(app);

    await freezeApp('myapp', 'crash looping');

    expect(mockStopService).toHaveBeenCalledWith('myapp');
    expect(mockDisableService).toHaveBeenCalledWith('myapp');
    expect(app.frozenAt).toBeDefined();
    expect(app.frozenReason).toBe('crash looping');
    expect(mockSave).toHaveBeenCalledWith(reg);
  });

  it('sets frozenAt without reason when reason is omitted', async () => {
    const app = makeApp();
    const reg = makeRegistry(app);
    mockLoad.mockReturnValue(reg);
    mockFindApp.mockReturnValue(app);

    await freezeApp('myapp');

    expect(app.frozenAt).toBeDefined();
    expect(app.frozenReason).toBeUndefined();
  });

  it('throws AppNotFoundError if app does not exist', async () => {
    const reg = makeRegistry(makeApp());
    mockLoad.mockReturnValue(reg);
    mockFindApp.mockReturnValue(undefined);

    await expect(freezeApp('nonexistent')).rejects.toBeInstanceOf(AppNotFoundError);
  });

  it('throws if app is already frozen', async () => {
    const app = makeApp({ frozenAt: '2026-01-01T00:00:00.000Z' });
    const reg = makeRegistry(app);
    mockLoad.mockReturnValue(reg);
    mockFindApp.mockReturnValue(app);

    await expect(freezeApp('myapp')).rejects.toThrow(/already frozen/);
  });
});

describe('unfreezeApp', () => {
  it('clears frozen fields, saves, enables, and starts the service', async () => {
    const app = makeApp({ frozenAt: '2026-01-01T00:00:00.000Z', frozenReason: 'crash looping' });
    const reg = makeRegistry(app);
    mockLoad.mockReturnValue(reg);
    mockFindApp.mockReturnValue(app);

    await unfreezeApp('myapp');

    expect(app.frozenAt).toBeUndefined();
    expect(app.frozenReason).toBeUndefined();
    expect(mockSave).toHaveBeenCalledWith(reg);
    expect(mockEnableService).toHaveBeenCalledWith('myapp');
    expect(mockStartService).toHaveBeenCalledWith('myapp');
  });

  it('throws AppNotFoundError if app does not exist', async () => {
    const reg = makeRegistry(makeApp());
    mockLoad.mockReturnValue(reg);
    mockFindApp.mockReturnValue(undefined);

    await expect(unfreezeApp('nonexistent')).rejects.toBeInstanceOf(AppNotFoundError);
  });

  it('throws if app is not frozen', async () => {
    const app = makeApp();
    const reg = makeRegistry(app);
    mockLoad.mockReturnValue(reg);
    mockFindApp.mockReturnValue(app);

    await expect(unfreezeApp('myapp')).rejects.toThrow(/not frozen/);
  });
});
