import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../core/registry.js', () => ({
  load: vi.fn(),
  findApp: vi.fn(),
}));

vi.mock('../core/systemd.js', () => ({
  startService: vi.fn(),
}));

vi.mock('../ui/output.js', () => ({
  success: vi.fn(),
  error: vi.fn(),
}));

import { load, findApp } from '../core/registry.js';
import { startService } from '../core/systemd.js';
import { success, error } from '../ui/output.js';
import { startCommand } from './start.js';

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
});

describe('startCommand', () => {
  const mockApp = { name: 'myapp', serviceName: 'fleet-myapp' };

  it('starts the service for a valid app', () => {
    vi.mocked(load).mockReturnValue({ apps: [mockApp] } as any);
    vi.mocked(findApp).mockReturnValue(mockApp as any);
    vi.mocked(startService).mockReturnValue(true);

    startCommand(['myapp']);

    expect(startService).toHaveBeenCalledWith('fleet-myapp');
    expect(success).toHaveBeenCalledWith('Started myapp');
  });

  it('exits with error when service fails to start', () => {
    vi.mocked(load).mockReturnValue({ apps: [mockApp] } as any);
    vi.mocked(findApp).mockReturnValue(mockApp as any);
    vi.mocked(startService).mockReturnValue(false);

    expect(() => startCommand(['myapp'])).toThrow('exit');
    expect(error).toHaveBeenCalledWith('Failed to start myapp');
  });

  it('exits with error when no app name provided', () => {
    expect(() => startCommand([])).toThrow('exit');
    expect(error).toHaveBeenCalledWith('Usage: fleet start <app>');
  });

  it('throws AppNotFoundError for unknown app', () => {
    vi.mocked(load).mockReturnValue({ apps: [] } as any);
    vi.mocked(findApp).mockReturnValue(undefined as any);

    expect(() => startCommand(['unknown'])).toThrow();
  });
});
