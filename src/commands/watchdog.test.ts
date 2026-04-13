import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('node:fs', async () => {
  const actual = await vi.importActual<typeof import('node:fs')>('node:fs');
  return { ...actual, readFileSync: vi.fn() };
});

vi.mock('../core/registry.js', () => ({
  load: vi.fn(),
}));

vi.mock('../core/health.js', () => ({
  checkAllHealth: vi.fn(),
}));

vi.mock('../core/systemd.js', () => ({
  getServiceStatus: vi.fn(),
}));

vi.mock('../core/notify.js', () => ({
  loadNotifyConfig: vi.fn(),
  sendNotification: vi.fn(),
}));

vi.mock('../ui/output.js', () => ({
  success: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
}));

import { readFileSync } from 'node:fs';
import { load } from '../core/registry.js';
import { checkAllHealth } from '../core/health.js';
import { getServiceStatus } from '../core/systemd.js';
import { loadNotifyConfig, sendNotification } from '../core/notify.js';
import { success, warn } from '../ui/output.js';
import { watchdogCommand } from './watchdog.js';

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
  vi.mocked(readFileSync).mockReturnValue('test-host');
});

describe('watchdogCommand', () => {
  it('reports all healthy when everything is up', async () => {
    vi.mocked(getServiceStatus).mockReturnValue({ name: 'docker-databases', active: true, enabled: true, state: 'active', description: '' });
    vi.mocked(load).mockReturnValue({ apps: [] } as any);
    vi.mocked(checkAllHealth).mockReturnValue([]);

    await watchdogCommand([]);

    expect(success).toHaveBeenCalledWith(expect.stringContaining('healthy'));
  });

  it('reports failures and sends alerts', async () => {
    vi.mocked(getServiceStatus).mockReturnValue({ name: 'docker-databases', active: false, enabled: true, state: 'inactive', description: '' });
    vi.mocked(load).mockReturnValue({ apps: [] } as any);
    vi.mocked(checkAllHealth).mockReturnValue([]);
    vi.mocked(loadNotifyConfig).mockReturnValue({ adapters: [] } as any);
    vi.mocked(sendNotification).mockResolvedValue(true);

    await expect(watchdogCommand([])).rejects.toThrow('exit');
    expect(warn).toHaveBeenCalled();
  });

  it('in motd mode, reports failures but does not send alerts', async () => {
    vi.mocked(getServiceStatus).mockReturnValue({ name: 'docker-databases', active: false, enabled: true, state: 'inactive', description: '' });
    vi.mocked(load).mockReturnValue({ apps: [] } as any);
    vi.mocked(checkAllHealth).mockReturnValue([]);

    await watchdogCommand(['--motd']);

    expect(warn).toHaveBeenCalled();
    expect(loadNotifyConfig).not.toHaveBeenCalled();
  });
});
