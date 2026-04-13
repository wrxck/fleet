import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../core/registry.js', () => ({
  load: vi.fn(),
  findApp: vi.fn(),
}));

vi.mock('../core/systemd.js', () => ({
  restartService: vi.fn(),
}));

vi.mock('../ui/output.js', () => ({
  success: vi.fn(),
  error: vi.fn(),
}));

import { load, findApp } from '../core/registry.js';
import { restartService } from '../core/systemd.js';
import { success, error } from '../ui/output.js';
import { restartCommand } from './restart.js';

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
});

describe('restartCommand', () => {
  const mockApp = { name: 'myapp', serviceName: 'fleet-myapp' };

  it('restarts the service for a valid app', () => {
    vi.mocked(load).mockReturnValue({ apps: [mockApp] } as any);
    vi.mocked(findApp).mockReturnValue(mockApp as any);
    vi.mocked(restartService).mockReturnValue(true);

    restartCommand(['myapp']);

    expect(restartService).toHaveBeenCalledWith('fleet-myapp');
    expect(success).toHaveBeenCalledWith('Restarted myapp');
  });

  it('exits with error when service fails to restart', () => {
    vi.mocked(load).mockReturnValue({ apps: [mockApp] } as any);
    vi.mocked(findApp).mockReturnValue(mockApp as any);
    vi.mocked(restartService).mockReturnValue(false);

    expect(() => restartCommand(['myapp'])).toThrow('exit');
    expect(error).toHaveBeenCalledWith('Failed to restart myapp');
  });

  it('exits with error when no app name provided', () => {
    expect(() => restartCommand([])).toThrow('exit');
  });

  it('throws for unknown app', () => {
    vi.mocked(load).mockReturnValue({ apps: [] } as any);
    vi.mocked(findApp).mockReturnValue(undefined as any);
    expect(() => restartCommand(['unknown'])).toThrow();
  });
});
