import { describe, it, expect, vi, beforeEach } from 'vitest';

import type { AppEntry, Registry } from '../core/registry.js';

vi.mock('../core/registry.js', () => ({
  load: vi.fn(),
  findApp: vi.fn(),
}));

vi.mock('../core/docker.js', () => ({
  getContainerLogs: vi.fn(),
}));

vi.mock('../core/exec.js', () => ({
  execLive: vi.fn(),
}));

vi.mock('../ui/output.js', () => ({
  error: vi.fn(),
  warn: vi.fn(),
  info: vi.fn(),
  success: vi.fn(),
  heading: vi.fn(),
  table: vi.fn(),
  c: { reset: '', bold: '', dim: '', red: '', green: '', yellow: '', blue: '',
       magenta: '', cyan: '', white: '', gray: '' },
}));

import { load, findApp } from '../core/registry.js';
import { getContainerLogs } from '../core/docker.js';
import { execLive } from '../core/exec.js';
import { error } from '../ui/output.js';
import { logsCommand } from './logs.js';

function makeApp(overrides: Partial<AppEntry> = {}): AppEntry {
  return {
    name: 'myapp',
    displayName: 'myapp',
    composePath: '/srv/myapp',
    composeFile: null,
    serviceName: 'fleet-myapp',
    domains: [],
    port: null,
    usesSharedDb: false,
    type: 'service',
    containers: ['myapp-web'],
    dependsOnDatabases: false,
    registeredAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function makeRegistry(apps: AppEntry[]): Registry {
  return {
    version: 1,
    apps,
    infrastructure: {
      databases: { serviceName: 'docker-databases', composePath: '' },
      nginx: { configPath: '/etc/nginx' },
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
  vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
});

describe('logsCommand', () => {
  it('shows logs for a valid app', () => {
    const app = makeApp();
    vi.mocked(load).mockReturnValue(makeRegistry([app]));
    vi.mocked(findApp).mockReturnValue(app);
    vi.mocked(getContainerLogs).mockReturnValue('log line 1\nlog line 2');

    logsCommand(['myapp']);

    expect(getContainerLogs).toHaveBeenCalledWith('myapp-web', 100);
  });

  it('follows logs with -f flag', () => {
    const app = makeApp();
    vi.mocked(load).mockReturnValue(makeRegistry([app]));
    vi.mocked(findApp).mockReturnValue(app);
    vi.mocked(execLive).mockReturnValue(0);

    expect(() => logsCommand(['myapp', '-f'])).toThrow('exit');
    expect(execLive).toHaveBeenCalledWith('docker', ['logs', '-f', '--tail', '100', 'myapp-web']);
  });

  it('respects -n flag for line count', () => {
    const app = makeApp();
    vi.mocked(load).mockReturnValue(makeRegistry([app]));
    vi.mocked(findApp).mockReturnValue(app);
    vi.mocked(getContainerLogs).mockReturnValue('');

    logsCommand(['myapp', '-n', '50']);

    expect(getContainerLogs).toHaveBeenCalledWith('myapp-web', 50);
  });

  it('exits with error when no app name provided', () => {
    expect(() => logsCommand([])).toThrow('exit');
    expect(error).toHaveBeenCalledWith('Usage: fleet logs <app> [-f] [-n <lines>] [-c <container>]');
  });

  it('exits with error when app has no containers', () => {
    const noCtApp = makeApp({ containers: [] });
    vi.mocked(load).mockReturnValue(makeRegistry([noCtApp]));
    vi.mocked(findApp).mockReturnValue(noCtApp);

    expect(() => logsCommand(['myapp'])).toThrow('exit');
    expect(error).toHaveBeenCalledWith('No containers registered for myapp');
  });

  it('selects a specific container with -c flag', () => {
    const multiApp = makeApp({ containers: ['myapp-web', 'myapp-worker'] });
    vi.mocked(load).mockReturnValue(makeRegistry([multiApp]));
    vi.mocked(findApp).mockReturnValue(multiApp);
    vi.mocked(getContainerLogs).mockReturnValue('');

    logsCommand(['myapp', '-c', 'myapp-worker']);

    expect(getContainerLogs).toHaveBeenCalledWith('myapp-worker', 100);
  });

  it('does not treat -c value as the app name', () => {
    const multiApp = makeApp({ containers: ['myapp-web', 'myapp-worker'] });
    vi.mocked(load).mockReturnValue(makeRegistry([multiApp]));
    vi.mocked(findApp).mockReturnValue(multiApp);
    vi.mocked(getContainerLogs).mockReturnValue('');

    logsCommand(['-c', 'myapp-worker', 'myapp']);

    expect(findApp).toHaveBeenCalledWith(expect.anything(), 'myapp');
    expect(getContainerLogs).toHaveBeenCalledWith('myapp-worker', 100);
  });

  it('exits when -c container is not in the app', () => {
    const app = makeApp();
    vi.mocked(load).mockReturnValue(makeRegistry([app]));
    vi.mocked(findApp).mockReturnValue(app);

    expect(() => logsCommand(['myapp', '-c', 'nope'])).toThrow('exit');
    expect(error).toHaveBeenCalledWith('Container "nope" not found in myapp. Available:');
  });
});
