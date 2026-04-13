import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../core/registry.js', () => ({
  load: vi.fn(),
}));

vi.mock('../core/systemd.js', () => ({
  systemdAvailable: vi.fn(),
  getMultipleServiceStatuses: vi.fn(),
}));

vi.mock('../core/docker.js', () => ({
  listContainers: vi.fn(),
}));

vi.mock('../ui/output.js', () => ({
  c: { green: '', red: '', yellow: '', dim: '', bold: '', reset: '' },
  icon: { ok: 'OK', err: 'ERR', warn: 'WARN', info: 'INFO' },
  heading: vi.fn(),
  table: vi.fn(),
  info: vi.fn(),
}));

import { load } from '../core/registry.js';
import { systemdAvailable, getMultipleServiceStatuses } from '../core/systemd.js';
import { listContainers } from '../core/docker.js';
import { getStatusData, statusCommand } from './status.js';

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
});

describe('getStatusData', () => {
  it('returns status for all registered apps', () => {
    const apps = [
      { name: 'app1', serviceName: 'fleet-app1', containers: ['app1-web'], frozenAt: null },
    ];
    vi.mocked(load).mockReturnValue({ apps } as any);
    vi.mocked(systemdAvailable).mockReturnValue(true);
    vi.mocked(getMultipleServiceStatuses).mockReturnValue(
      new Map([['fleet-app1', { name: 'fleet-app1', active: true, enabled: true, state: 'active', description: '' }]])
    );
    vi.mocked(listContainers).mockReturnValue([
      { name: 'app1-web', status: 'Up 2 hours', health: 'healthy', ports: '' },
    ] as any);

    const data = getStatusData();

    expect(data.totalApps).toBe(1);
    expect(data.healthy).toBe(1);
    expect(data.apps[0].health).toBe('healthy');
  });

  it('marks frozen apps as frozen', () => {
    const apps = [
      { name: 'frozen-app', serviceName: 'fleet-frozen', containers: ['c1'], frozenAt: '2026-01-01' },
    ];
    vi.mocked(load).mockReturnValue({ apps } as any);
    vi.mocked(systemdAvailable).mockReturnValue(false);
    vi.mocked(listContainers).mockReturnValue([]);

    const data = getStatusData();
    expect(data.apps[0].health).toBe('frozen');
  });

  it('handles no containers as unknown', () => {
    const apps = [
      { name: 'noct', serviceName: 'fleet-noct', containers: ['c1'], frozenAt: null },
    ];
    vi.mocked(load).mockReturnValue({ apps } as any);
    vi.mocked(systemdAvailable).mockReturnValue(false);
    vi.mocked(listContainers).mockReturnValue([]);

    const data = getStatusData();
    expect(data.apps[0].health).toBe('unknown');
  });
});

describe('statusCommand', () => {
  it('outputs JSON when --json flag is passed', () => {
    vi.mocked(load).mockReturnValue({ apps: [] } as any);
    vi.mocked(systemdAvailable).mockReturnValue(false);
    vi.mocked(listContainers).mockReturnValue([]);

    statusCommand(['--json']);

    expect(process.stdout.write).toHaveBeenCalled();
    const output = vi.mocked(process.stdout.write).mock.calls[0][0] as string;
    expect(() => JSON.parse(output)).not.toThrow();
  });
});
