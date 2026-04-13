import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../core/registry.js', () => ({
  load: vi.fn(),
  findApp: vi.fn(),
}));

vi.mock('../core/systemd.js', () => ({
  stopService: vi.fn(),
}));

vi.mock('../ui/output.js', () => ({
  success: vi.fn(),
  error: vi.fn(),
}));

import { load, findApp } from '../core/registry.js';
import { stopService } from '../core/systemd.js';
import { success, error } from '../ui/output.js';
import { stopCommand } from './stop.js';

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
});

describe('stopCommand', () => {
  const mockApp = { name: 'myapp', serviceName: 'fleet-myapp' };

  it('stops the service for a valid app', () => {
    vi.mocked(load).mockReturnValue({ apps: [mockApp] } as any);
    vi.mocked(findApp).mockReturnValue(mockApp as any);
    vi.mocked(stopService).mockReturnValue(true);

    stopCommand(['myapp']);

    expect(stopService).toHaveBeenCalledWith('fleet-myapp');
    expect(success).toHaveBeenCalledWith('Stopped myapp');
  });

  it('exits with error when service fails to stop', () => {
    vi.mocked(load).mockReturnValue({ apps: [mockApp] } as any);
    vi.mocked(findApp).mockReturnValue(mockApp as any);
    vi.mocked(stopService).mockReturnValue(false);

    expect(() => stopCommand(['myapp'])).toThrow('exit');
    expect(error).toHaveBeenCalledWith('Failed to stop myapp');
  });

  it('exits with error when no app name provided', () => {
    expect(() => stopCommand([])).toThrow('exit');
    expect(error).toHaveBeenCalledWith('Usage: fleet stop <app>');
  });

  it('throws for unknown app', () => {
    vi.mocked(load).mockReturnValue({ apps: [] } as any);
    vi.mocked(findApp).mockReturnValue(undefined as any);
    expect(() => stopCommand(['unknown'])).toThrow();
  });
});
