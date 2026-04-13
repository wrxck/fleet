import { describe, it, expect, vi, beforeEach } from 'vitest';

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
}));

import { load, findApp } from '../core/registry.js';
import { getContainerLogs } from '../core/docker.js';
import { execLive } from '../core/exec.js';
import { error } from '../ui/output.js';
import { logsCommand } from './logs.js';

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
  vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
});

describe('logsCommand', () => {
  const mockApp = { name: 'myapp', serviceName: 'fleet-myapp', containers: ['myapp-web'] };

  it('shows logs for a valid app', () => {
    vi.mocked(load).mockReturnValue({ apps: [mockApp] } as any);
    vi.mocked(findApp).mockReturnValue(mockApp as any);
    vi.mocked(getContainerLogs).mockReturnValue('log line 1\nlog line 2');

    logsCommand(['myapp']);

    expect(getContainerLogs).toHaveBeenCalledWith('myapp-web', 100);
  });

  it('follows logs with -f flag', () => {
    vi.mocked(load).mockReturnValue({ apps: [mockApp] } as any);
    vi.mocked(findApp).mockReturnValue(mockApp as any);
    vi.mocked(execLive).mockReturnValue(0);

    expect(() => logsCommand(['myapp', '-f'])).toThrow('exit');
    expect(execLive).toHaveBeenCalledWith('docker', ['logs', '-f', '--tail', '100', 'myapp-web']);
  });

  it('respects -n flag for line count', () => {
    vi.mocked(load).mockReturnValue({ apps: [mockApp] } as any);
    vi.mocked(findApp).mockReturnValue(mockApp as any);
    vi.mocked(getContainerLogs).mockReturnValue('');

    logsCommand(['myapp', '-n', '50']);

    expect(getContainerLogs).toHaveBeenCalledWith('myapp-web', 50);
  });

  it('exits with error when no app name provided', () => {
    expect(() => logsCommand([])).toThrow('exit');
    expect(error).toHaveBeenCalledWith('Usage: fleet logs <app> [-f] [-n <lines>]');
  });

  it('exits with error when app has no containers', () => {
    const noCtApp = { ...mockApp, containers: [] };
    vi.mocked(load).mockReturnValue({ apps: [noCtApp] } as any);
    vi.mocked(findApp).mockReturnValue(noCtApp as any);

    expect(() => logsCommand(['myapp'])).toThrow('exit');
    expect(error).toHaveBeenCalledWith('No containers registered for myapp');
  });
});
