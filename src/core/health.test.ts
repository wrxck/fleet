import { describe, it, expect, vi, beforeEach } from 'vitest';

import type { AppEntry } from './registry.js';
import type { ExecResult } from './exec.js';

vi.mock('./exec.js', () => ({
  exec: vi.fn(),
}));

vi.mock('./systemd.js', () => ({
  getServiceStatus: vi.fn(),
}));

vi.mock('./docker.js', () => ({
  listContainers: vi.fn(),
}));

import { exec } from './exec.js';
import { getServiceStatus } from './systemd.js';
import { listContainers } from './docker.js';
import { checkHealth, checkHttp } from './health.js';

const mockedExec = vi.mocked(exec);
const mockedGetServiceStatus = vi.mocked(getServiceStatus);
const mockedListContainers = vi.mocked(listContainers);

function makeApp(overrides: Partial<AppEntry> = {}): AppEntry {
  return {
    name: 'test-app',
    displayName: 'Test App',
    composePath: '/home/matt/test-app',
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
  mockedGetServiceStatus.mockReturnValue({ active: true, state: 'active', enabled: true });
  mockedListContainers.mockReturnValue([
    { name: 'test-app', status: 'Up 2 hours', health: 'healthy', ports: '0.0.0.0:3000->3000/tcp' },
  ]);
});

describe('checkHttp', () => {
  it('uses /health by default', () => {
    mockedExec.mockReturnValue({ stdout: '200', stderr: '', exitCode: 0, ok: true });
    checkHttp(3000);
    expect(mockedExec).toHaveBeenCalledWith(
      expect.stringContaining('http://127.0.0.1:3000/health'),
      expect.any(Object),
    );
  });

  it('uses custom healthPath when provided', () => {
    mockedExec.mockReturnValue({ stdout: '200', stderr: '', exitCode: 0, ok: true });
    checkHttp(8000, '/api/health');
    expect(mockedExec).toHaveBeenCalledWith(
      expect.stringContaining('http://127.0.0.1:8000/api/health'),
      expect.any(Object),
    );
  });

  it('does not use -f flag in curl command', () => {
    mockedExec.mockReturnValue({ stdout: '200', stderr: '', exitCode: 0, ok: true });
    checkHttp(3000);
    const cmd = mockedExec.mock.calls[0][0];
    expect(cmd).not.toMatch(/curl\s+-[^\s]*f/);
    expect(cmd).toContain('curl -s');
  });

  it('returns ok for HTTP 200', () => {
    mockedExec.mockReturnValue({ stdout: '200', stderr: '', exitCode: 0, ok: true });
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
    mockedExec.mockReturnValue({ stdout: '200', stderr: '', exitCode: 0, ok: true });
    const result = checkHealth(makeApp());
    expect(result.overall).toBe('healthy');
  });

  it('returns degraded when http check fails', () => {
    mockedExec.mockReturnValue({ stdout: '500', stderr: '', exitCode: 0, ok: true });
    const result = checkHealth(makeApp());
    expect(result.overall).toBe('degraded');
  });

  it('returns down when systemd and containers are both down', () => {
    mockedGetServiceStatus.mockReturnValue({ active: false, state: 'inactive', enabled: true });
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
    mockedExec.mockReturnValue({ stdout: '200', stderr: '', exitCode: 0, ok: true });
    checkHealth(makeApp({ port: 8000, healthPath: '/api/health' }));
    expect(mockedExec).toHaveBeenCalledWith(
      expect.stringContaining('/api/health'),
      expect.any(Object),
    );
  });
});
