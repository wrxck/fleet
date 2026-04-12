import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../core/registry.js', () => ({
  load: vi.fn(),
  save: vi.fn(),
  findApp: vi.fn(),
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
  it('stops, disables, sets frozen fields, and saves', () => {
    const app = makeApp();
    const reg = makeRegistry(app);
    mockLoad.mockReturnValue(reg);
    mockFindApp.mockReturnValue(app);

    freezeApp('myapp', 'crash looping');

    expect(mockStopService).toHaveBeenCalledWith('myapp');
    expect(mockDisableService).toHaveBeenCalledWith('myapp');
    expect(app.frozenAt).toBeDefined();
    expect(app.frozenReason).toBe('crash looping');
    expect(mockSave).toHaveBeenCalledWith(reg);
  });

  it('sets frozenAt without reason when reason is omitted', () => {
    const app = makeApp();
    const reg = makeRegistry(app);
    mockLoad.mockReturnValue(reg);
    mockFindApp.mockReturnValue(app);

    freezeApp('myapp');

    expect(app.frozenAt).toBeDefined();
    expect(app.frozenReason).toBeUndefined();
  });

  it('throws AppNotFoundError if app does not exist', () => {
    const reg = makeRegistry(makeApp());
    mockLoad.mockReturnValue(reg);
    mockFindApp.mockReturnValue(undefined);

    expect(() => freezeApp('nonexistent')).toThrow(AppNotFoundError);
  });

  it('throws if app is already frozen', () => {
    const app = makeApp({ frozenAt: '2026-01-01T00:00:00.000Z' });
    const reg = makeRegistry(app);
    mockLoad.mockReturnValue(reg);
    mockFindApp.mockReturnValue(app);

    expect(() => freezeApp('myapp')).toThrow(/already frozen/);
  });
});

describe('unfreezeApp', () => {
  it('clears frozen fields, saves, enables, and starts the service', () => {
    const app = makeApp({ frozenAt: '2026-01-01T00:00:00.000Z', frozenReason: 'crash looping' });
    const reg = makeRegistry(app);
    mockLoad.mockReturnValue(reg);
    mockFindApp.mockReturnValue(app);

    unfreezeApp('myapp');

    expect(app.frozenAt).toBeUndefined();
    expect(app.frozenReason).toBeUndefined();
    expect(mockSave).toHaveBeenCalledWith(reg);
    expect(mockEnableService).toHaveBeenCalledWith('myapp');
    expect(mockStartService).toHaveBeenCalledWith('myapp');
  });

  it('throws AppNotFoundError if app does not exist', () => {
    const reg = makeRegistry(makeApp());
    mockLoad.mockReturnValue(reg);
    mockFindApp.mockReturnValue(undefined);

    expect(() => unfreezeApp('nonexistent')).toThrow(AppNotFoundError);
  });

  it('throws if app is not frozen', () => {
    const app = makeApp();
    const reg = makeRegistry(app);
    mockLoad.mockReturnValue(reg);
    mockFindApp.mockReturnValue(app);

    expect(() => unfreezeApp('myapp')).toThrow(/not frozen/);
  });
});
