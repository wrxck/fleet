import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../core/registry.js', () => ({
  load: vi.fn(),
  save: vi.fn(),
  findApp: vi.fn(),
  removeApp: vi.fn(),
  withRegistry: vi.fn(async (fn: (r: unknown) => unknown | Promise<unknown>) => {
    const mod = await vi.importMock<typeof import('../core/registry.js')>('../core/registry.js');
    const reg = (mod.load as unknown as { (): unknown })();
    const next = await fn(reg);
    (mod.save as unknown as { (r: unknown): void })(next);
  }),
}));

vi.mock('../core/systemd.js', () => ({
  stopService: vi.fn(),
  disableService: vi.fn(),
}));

vi.mock('../ui/output.js', () => ({
  success: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
}));

vi.mock('../ui/confirm.js', () => ({
  confirm: vi.fn(),
}));

import { load, save, findApp, removeApp } from '../core/registry.js';
import { stopService, disableService } from '../core/systemd.js';
import { success, info } from '../ui/output.js';
import { confirm } from '../ui/confirm.js';
import { removeCommand } from './remove.js';

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
});

describe('removeCommand', () => {
  const mockApp = { name: 'myapp', serviceName: 'fleet-myapp' };
  const mockReg = { apps: [mockApp] };

  it('removes an app with -y flag (no confirmation)', async () => {
    vi.mocked(load).mockReturnValue(mockReg as any);
    vi.mocked(findApp).mockReturnValue(mockApp as any);
    vi.mocked(removeApp).mockReturnValue({ apps: [] } as any);

    await removeCommand(['myapp', '-y']);

    expect(stopService).toHaveBeenCalledWith('fleet-myapp');
    expect(disableService).toHaveBeenCalledWith('fleet-myapp');
    expect(save).toHaveBeenCalled();
    expect(success).toHaveBeenCalled();
  });

  it('cancels when user declines confirmation', async () => {
    vi.mocked(load).mockReturnValue(mockReg as any);
    vi.mocked(findApp).mockReturnValue(mockApp as any);
    vi.mocked(confirm).mockResolvedValue(false);

    await removeCommand(['myapp']);

    expect(info).toHaveBeenCalledWith('Cancelled');
    expect(stopService).not.toHaveBeenCalled();
  });

  it('exits with error when no app name provided', async () => {
    await expect(removeCommand([])).rejects.toThrow('exit');
  });

  it('throws for unknown app', async () => {
    vi.mocked(load).mockReturnValue({ apps: [] } as any);
    vi.mocked(findApp).mockReturnValue(undefined as any);
    await expect(removeCommand(['unknown', '-y'])).rejects.toThrow();
  });
});
