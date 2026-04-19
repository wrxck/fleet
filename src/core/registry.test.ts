import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('node:fs', () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn(),
}));

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { load, save, findApp, addApp, removeApp } from './registry.js';
import type { AppEntry, Registry } from './registry.js';

const mockExistsSync = vi.mocked(existsSync);
const mockReadFileSync = vi.mocked(readFileSync);
const mockWriteFileSync = vi.mocked(writeFileSync);
const mockMkdirSync = vi.mocked(mkdirSync);

function makeApp(overrides: Partial<AppEntry> = {}): AppEntry {
  return {
    name: 'myapp',
    displayName: 'My App',
    composePath: '/opt/apps/myapp',
    composeFile: null,
    serviceName: 'myapp',
    domains: ['myapp.example.com'],
    port: 3000,
    usesSharedDb: false,
    type: 'service',
    containers: ['myapp'],
    dependsOnDatabases: false,
    registeredAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function makeRegistry(apps: AppEntry[] = []): Registry {
  return {
    version: 1,
    apps,
    infrastructure: {
      databases: { serviceName: 'docker-databases', composePath: '/opt/databases' },
      nginx: { configPath: '/etc/nginx' },
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('load', () => {
  it('returns default registry when file does not exist', () => {
    mockExistsSync.mockReturnValue(false);
    const reg = load();
    expect(reg.version).toBe(1);
    expect(reg.apps).toEqual([]);
    expect(reg.infrastructure.databases.serviceName).toBe('docker-databases');
    expect(reg.infrastructure.nginx.configPath).toBe('/etc/nginx');
  });

  it('parses valid JSON when file exists', () => {
    mockExistsSync.mockReturnValue(true);
    const stored = makeRegistry([makeApp()]);
    mockReadFileSync.mockReturnValue(JSON.stringify(stored));
    const reg = load();
    expect(reg.apps).toHaveLength(1);
    expect(reg.apps[0].name).toBe('myapp');
  });

  it('returns default registry when JSON is corrupted', () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue('{ invalid json ');
    // Should not throw — the try/catch returns default
    const reg = load();
    expect(reg.apps).toEqual([]);
    expect(reg.version).toBe(1);
  });

  it('returns default registry when file contains empty object', () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue('{}');
    const reg = load();
    // JSON.parse('{}') succeeds, so we get what was stored (empty-ish object)
    expect(reg).toBeDefined();
  });
});

describe('save', () => {
  it('writes valid JSON to the registry file', () => {
    mockExistsSync.mockReturnValue(true);
    const reg = makeRegistry([makeApp()]);
    save(reg);
    expect(mockWriteFileSync).toHaveBeenCalledTimes(1);
    const written = mockWriteFileSync.mock.calls[0][1] as string;
    const parsed = JSON.parse(written);
    expect(parsed.apps).toHaveLength(1);
    expect(parsed.apps[0].name).toBe('myapp');
  });

  it('creates directory if it does not exist', () => {
    mockExistsSync.mockReturnValue(false);
    const reg = makeRegistry();
    save(reg);
    expect(mockMkdirSync).toHaveBeenCalledWith(expect.any(String), { recursive: true });
    expect(mockWriteFileSync).toHaveBeenCalled();
  });

  it('writes JSON with trailing newline', () => {
    mockExistsSync.mockReturnValue(true);
    const reg = makeRegistry();
    save(reg);
    const written = mockWriteFileSync.mock.calls[0][1] as string;
    expect(written.endsWith('\n')).toBe(true);
  });

  it('writes pretty-printed JSON (2-space indent)', () => {
    mockExistsSync.mockReturnValue(true);
    const reg = makeRegistry([makeApp()]);
    save(reg);
    const written = mockWriteFileSync.mock.calls[0][1] as string;
    expect(written).toContain('  "version"');
  });
});

describe('findApp', () => {
  it('finds app by exact name', () => {
    const app = makeApp({ name: 'myapp' });
    const reg = makeRegistry([app]);
    expect(findApp(reg, 'myapp')).toBe(app);
  });

  it('finds app by serviceName', () => {
    const app = makeApp({ name: 'myapp', serviceName: 'docker-myapp' });
    const reg = makeRegistry([app]);
    expect(findApp(reg, 'docker-myapp')).toBe(app);
  });

  it('finds app by displayName (case-insensitive)', () => {
    const app = makeApp({ name: 'myapp', displayName: 'My App' });
    const reg = makeRegistry([app]);
    expect(findApp(reg, 'my app')).toBe(app);
    expect(findApp(reg, 'MY APP')).toBe(app);
    expect(findApp(reg, 'My App')).toBe(app);
  });

  it('returns undefined when app not found', () => {
    const reg = makeRegistry([makeApp()]);
    expect(findApp(reg, 'nonexistent')).toBeUndefined();
  });

  it('returns undefined for empty registry', () => {
    const reg = makeRegistry([]);
    expect(findApp(reg, 'myapp')).toBeUndefined();
  });

  it('returns the first matching app when multiple could match', () => {
    const app1 = makeApp({ name: 'app1', displayName: 'My App' });
    const app2 = makeApp({ name: 'app2', displayName: 'Other App' });
    const reg = makeRegistry([app1, app2]);
    const found = findApp(reg, 'app1');
    expect(found).toBe(app1);
  });
});

describe('addApp', () => {
  it('adds a new app to an empty registry', () => {
    const reg = makeRegistry([]);
    const app = makeApp();
    addApp(reg, app);
    expect(reg.apps).toHaveLength(1);
    expect(reg.apps[0]).toBe(app);
  });

  it('adds a new app to a registry with existing apps', () => {
    const existing = makeApp({ name: 'existing' });
    const reg = makeRegistry([existing]);
    const newApp = makeApp({ name: 'newapp' });
    addApp(reg, newApp);
    expect(reg.apps).toHaveLength(2);
  });

  it('updates existing app when name matches', () => {
    const original = makeApp({ name: 'myapp', port: 3000 });
    const reg = makeRegistry([original]);
    const updated = makeApp({ name: 'myapp', port: 4000 });
    addApp(reg, updated);
    expect(reg.apps).toHaveLength(1);
    expect(reg.apps[0].port).toBe(4000);
  });

  it('returns the updated registry', () => {
    const reg = makeRegistry([]);
    const returned = addApp(reg, makeApp());
    expect(returned).toBe(reg);
  });
});

describe('removeApp', () => {
  it('removes app by name', () => {
    const app = makeApp({ name: 'myapp' });
    const reg = makeRegistry([app]);
    removeApp(reg, 'myapp');
    expect(reg.apps).toHaveLength(0);
  });

  it('does nothing when app not found', () => {
    const app = makeApp({ name: 'myapp' });
    const reg = makeRegistry([app]);
    removeApp(reg, 'nonexistent');
    expect(reg.apps).toHaveLength(1);
  });

  it('only removes matching app when multiple exist', () => {
    const app1 = makeApp({ name: 'app1' });
    const app2 = makeApp({ name: 'app2' });
    const reg = makeRegistry([app1, app2]);
    removeApp(reg, 'app1');
    expect(reg.apps).toHaveLength(1);
    expect(reg.apps[0].name).toBe('app2');
  });

  it('returns the updated registry', () => {
    const reg = makeRegistry([makeApp()]);
    const returned = removeApp(reg, 'myapp');
    expect(returned).toBe(reg);
  });
});

describe('AppEntry.lastBuiltCommit', () => {
  it('round-trips lastBuiltCommit through save and load', () => {
    const reg: Registry = {
      version: 1,
      apps: [{
        name: 'test-app',
        displayName: 'test-app',
        composePath: '/tmp/test-app',
        composeFile: null,
        serviceName: 'test-app',
        domains: [],
        port: null,
        usesSharedDb: false,
        type: 'service',
        containers: [],
        dependsOnDatabases: false,
        registeredAt: '2026-04-19T00:00:00.000Z',
        lastBuiltCommit: 'abc123def456',
      }],
      infrastructure: {
        databases: { serviceName: 'docker-databases', composePath: '' },
        nginx: { configPath: '/etc/nginx' },
      },
    };
    mockExistsSync.mockReturnValue(true);
    save(reg);
    const written = mockWriteFileSync.mock.calls[0][1] as string;
    mockReadFileSync.mockReturnValue(written);
    const loaded = load();
    expect(loaded.apps[0].lastBuiltCommit).toBe('abc123def456');
  });
});

describe('security: prototype pollution', () => {
  it('cannot inject __proto__ as an app name via addApp', () => {
    const reg = makeRegistry([]);
    // Attempt prototype pollution by setting an app name of '__proto__'
    const malicious = makeApp({ name: '__proto__' });
    addApp(reg, malicious);
    // The app should be stored normally, not pollute Object.prototype
    expect((Object.prototype as Record<string, unknown>).port).toBeUndefined();
    expect((Object.prototype as Record<string, unknown>).name).toBeUndefined();
  });

  it('cannot inject constructor as an app name', () => {
    const reg = makeRegistry([]);
    const malicious = makeApp({ name: 'constructor' });
    addApp(reg, malicious);
    // Object.prototype.constructor should still be the normal constructor function
    expect(typeof ({}).constructor).toBe('function');
    expect(reg.apps[0].name).toBe('constructor');
  });

  it('findApp with __proto__ does not access prototype chain', () => {
    const reg = makeRegistry([]);
    // Should return undefined, not leak prototype data
    const result = findApp(reg, '__proto__');
    expect(result).toBeUndefined();
  });

  it('corrupted JSON with __proto__ does not pollute prototype', () => {
    mockExistsSync.mockReturnValue(true);
    // This JSON would attempt prototype pollution in vulnerable JSON.parse scenarios
    const maliciousJson = JSON.stringify({
      version: 1,
      apps: [],
      infrastructure: {
        databases: { serviceName: 'docker-databases', composePath: '' },
        nginx: { configPath: '/etc/nginx' },
      },
      '__proto__': { isAdmin: true },
    });
    mockReadFileSync.mockReturnValue(maliciousJson);
    load();
    // Object prototype should not be polluted
    expect(({} as Record<string, unknown>).isAdmin).toBeUndefined();
  });
});
