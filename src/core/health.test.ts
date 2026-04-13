import { describe, it, expect, vi, beforeEach } from 'vitest';

import type { AppEntry } from './registry.js';

vi.mock('./exec.js', () => ({
  execSafe: vi.fn(),
}));

vi.mock('./validate.js', () => ({
  assertHealthPath: vi.fn(),
}));

vi.mock('./systemd.js', () => ({
  getServiceStatus: vi.fn(),
  getMultipleServiceStatuses: vi.fn(),
  systemdAvailable: vi.fn(),
}));

vi.mock('./docker.js', () => ({
  listContainers: vi.fn(),
}));

import { execSafe } from './exec.js';
import { getServiceStatus, getMultipleServiceStatuses, systemdAvailable } from './systemd.js';
import { listContainers } from './docker.js';
import { checkHealth, checkHttp, checkAllHealth } from './health.js';

const mockedExec = vi.mocked(execSafe);
const mockedGetServiceStatus = vi.mocked(getServiceStatus);
const mockedGetMultipleServiceStatuses = vi.mocked(getMultipleServiceStatuses);
const mockedSystemdAvailable = vi.mocked(systemdAvailable);
const mockedListContainers = vi.mocked(listContainers);

function makeApp(overrides: Partial<AppEntry> = {}): AppEntry {
  return {
    name: 'test-app',
    displayName: 'Test App',
    composePath: '/opt/apps/test-app',
    composeFile: null,
    serviceName: 'test-app',
    domains: [],
    port: 3000,
    usesSharedDb: false,
    type: 'service',
    containers: ['test-app'],
    dependsOnDatabases: false,
    registeredAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockedSystemdAvailable.mockReturnValue(true);
  mockedGetServiceStatus.mockReturnValue({
    name: 'test-app', active: true, enabled: true, state: 'active', description: '',
  });
  mockedListContainers.mockReturnValue([
    { name: 'test-app', status: 'Up 2 hours', health: 'healthy', ports: '0.0.0.0:3000->3000/tcp', image: 'test:latest', uptime: '2 hours' },
  ]);
  mockedExec.mockReturnValue({ stdout: '200', stderr: '', exitCode: 0, ok: true });
});

describe('checkHttp', () => {
  it('uses /health by default', () => {
    checkHttp(3000);
    expect(mockedExec).toHaveBeenCalledWith(
      'curl',
      expect.arrayContaining(['http://127.0.0.1:3000/health']),
      expect.any(Object),
    );
  });

  it('uses custom healthPath when provided', () => {
    checkHttp(8000, '/api/health');
    expect(mockedExec).toHaveBeenCalledWith(
      'curl',
      expect.arrayContaining(['http://127.0.0.1:8000/api/health']),
      expect.any(Object),
    );
  });

  it('does not use -f flag in curl command', () => {
    checkHttp(3000);
    const args = mockedExec.mock.calls[0][1] as string[];
    expect(args).not.toContain('-f');
    expect(args).toContain('-s');
  });

  it('returns ok for HTTP 200', () => {
    const result = checkHttp(3000);
    expect(result).toEqual({ ok: true, status: 200, error: null });
  });

  it('returns ok for HTTP 404 (< 500)', () => {
    mockedExec.mockReturnValue({ stdout: '404', stderr: '', exitCode: 0, ok: true });
    const result = checkHttp(3000);
    expect(result).toEqual({ ok: true, status: 404, error: null });
  });

  it('returns not ok for HTTP 500', () => {
    mockedExec.mockReturnValue({ stdout: '500', stderr: '', exitCode: 0, ok: true });
    const result = checkHttp(3000);
    expect(result).toEqual({ ok: false, status: 500, error: null });
  });

  it('returns not ok for connection refused', () => {
    mockedExec.mockReturnValue({ stdout: '000', stderr: 'Connection refused', exitCode: 7, ok: false });
    const result = checkHttp(3000);
    expect(result).toEqual({ ok: false, status: null, error: 'Connection refused' });
  });
});

describe('checkHealth', () => {
  it('returns healthy when all checks pass', () => {
    const result = checkHealth(makeApp());
    expect(result.overall).toBe('healthy');
  });

  it('returns degraded when http check fails', () => {
    mockedExec.mockReturnValue({ stdout: '500', stderr: '', exitCode: 0, ok: true });
    const result = checkHealth(makeApp());
    expect(result.overall).toBe('degraded');
  });

  it('returns down when containers are not found', () => {
    mockedGetServiceStatus.mockReturnValue({
      name: 'test-app', active: false, enabled: true, state: 'inactive', description: '',
    });
    mockedListContainers.mockReturnValue([]);
    const result = checkHealth(makeApp());
    expect(result.overall).toBe('down');
  });

  it('skips http check when port is null', () => {
    const result = checkHealth(makeApp({ port: null }));
    expect(result.http).toBeNull();
    expect(mockedExec).not.toHaveBeenCalled();
  });

  it('passes healthPath to checkHttp', () => {
    checkHealth(makeApp({ port: 8000, healthPath: '/api/health' }));
    expect(mockedExec).toHaveBeenCalledWith(
      'curl',
      expect.arrayContaining(['http://127.0.0.1:8000/api/health']),
      expect.any(Object),
    );
  });

  it('uses prefetched data when provided', () => {
    const prefetched = {
      containers: [
        { name: 'test-app', status: 'Up 1 hour', health: 'healthy', ports: '', image: '', uptime: '1 hour' },
      ],
      serviceStatus: { name: 'test-app', active: true, enabled: true, state: 'active', description: '' },
    };

    const result = checkHealth(makeApp(), prefetched);
    expect(result.overall).toBe('healthy');
    expect(mockedListContainers).not.toHaveBeenCalled();
    expect(mockedGetServiceStatus).not.toHaveBeenCalled();
    expect(mockedSystemdAvailable).not.toHaveBeenCalled();
  });

  it('skips systemd when not available', () => {
    mockedSystemdAvailable.mockReturnValue(false);
    const result = checkHealth(makeApp());
    expect(result.systemd).toEqual({ ok: false, state: 'n/a' });
    expect(mockedGetServiceStatus).not.toHaveBeenCalled();
  });
});

describe('checkAllHealth', () => {
  it('calls listContainers once for multiple apps', () => {
    mockedGetMultipleServiceStatuses.mockReturnValue(new Map([
      ['app-a', { name: 'app-a', active: true, enabled: true, state: 'active', description: '' }],
      ['app-b', { name: 'app-b', active: true, enabled: true, state: 'active', description: '' }],
    ]));
    mockedListContainers.mockReturnValue([
      { name: 'app-a', status: 'Up 1 hour', health: 'healthy', ports: '', image: '', uptime: '1 hour' },
      { name: 'app-b', status: 'Up 2 hours', health: 'healthy', ports: '', image: '', uptime: '2 hours' },
    ]);

    const apps = [
      makeApp({ name: 'app-a', serviceName: 'app-a', containers: ['app-a'], port: 3000 }),
      makeApp({ name: 'app-b', serviceName: 'app-b', containers: ['app-b'], port: 4000 }),
    ];

    const results = checkAllHealth(apps);

    expect(mockedListContainers).toHaveBeenCalledTimes(1);
    expect(results).toHaveLength(2);
    expect(results[0].overall).toBe('healthy');
    expect(results[1].overall).toBe('healthy');
  });

  it('calls getMultipleServiceStatuses once with all service names', () => {
    mockedGetMultipleServiceStatuses.mockReturnValue(new Map());
    mockedListContainers.mockReturnValue([]);

    const apps = [
      makeApp({ name: 'app-a', serviceName: 'svc-a', containers: ['app-a'] }),
      makeApp({ name: 'app-b', serviceName: 'svc-b', containers: ['app-b'] }),
      makeApp({ name: 'app-c', serviceName: 'svc-c', containers: ['app-c'] }),
    ];

    checkAllHealth(apps);

    expect(mockedGetMultipleServiceStatuses).toHaveBeenCalledTimes(1);
    expect(mockedGetMultipleServiceStatuses).toHaveBeenCalledWith(['svc-a', 'svc-b', 'svc-c']);
  });

  it('does not call per-app getServiceStatus or listContainers', () => {
    mockedGetMultipleServiceStatuses.mockReturnValue(new Map());
    mockedListContainers.mockReturnValue([]);

    checkAllHealth([makeApp()]);

    expect(mockedGetServiceStatus).not.toHaveBeenCalled();
    // listContainers is called once at batch level, not per-app
    expect(mockedListContainers).toHaveBeenCalledTimes(1);
  });

  it('correctly reports mixed health states', () => {
    mockedGetMultipleServiceStatuses.mockReturnValue(new Map([
      ['healthy-app', { name: 'healthy-app', active: true, enabled: true, state: 'active', description: '' }],
      ['down-app', { name: 'down-app', active: false, enabled: true, state: 'inactive', description: '' }],
    ]));
    mockedListContainers.mockReturnValue([
      { name: 'healthy-app', status: 'Up 1 hour', health: 'healthy', ports: '', image: '', uptime: '1 hour' },
    ]);

    const apps = [
      makeApp({ name: 'healthy-app', serviceName: 'healthy-app', containers: ['healthy-app'], port: null }),
      makeApp({ name: 'down-app', serviceName: 'down-app', containers: ['down-app'], port: null }),
    ];

    const results = checkAllHealth(apps);

    expect(results[0].overall).toBe('healthy');
    expect(results[1].overall).toBe('down');
  });

  it('skips systemd batch when systemd unavailable', () => {
    mockedSystemdAvailable.mockReturnValue(false);
    mockedListContainers.mockReturnValue([]);

    checkAllHealth([makeApp()]);

    expect(mockedGetMultipleServiceStatuses).not.toHaveBeenCalled();
  });
});
