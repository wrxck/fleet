import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../core/registry', () => ({
  load: vi.fn(),
}));

vi.mock('../core/systemd', () => ({
  systemdAvailable: vi.fn(),
  getMultipleServiceStatuses: vi.fn(),
}));

vi.mock('../core/docker', () => ({
  listContainers: vi.fn(),
}));

import { load } from '../core/registry';
import type { Registry, AppEntry } from '../core/registry';
import { systemdAvailable, getMultipleServiceStatuses } from '../core/systemd';
import { listContainers } from '../core/docker';
import type { ContainerInfo } from '../core/docker';
import { getStatusData, statusCommand } from './status';
import { makeCliContext } from '../registry/context';

beforeEach(() => {
  vi.clearAllMocks();
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

describe('status CommandDef', () => {
  it('has registry metadata', () => {
    expect(statusCommand.name).toBe('status');
    expect(statusCommand.tui).toEqual({ view: 'dashboard' });
  });

  it('run returns a CommandResult with a table render and structured data', async () => {
    const emptyRegistry: Registry = {
      version: 1,
      apps: [],
      infrastructure: {
        databases: { serviceName: 'docker-databases', composePath: '' },
        nginx: { configPath: '/etc/nginx' },
      },
    };
    vi.mocked(load).mockReturnValue(emptyRegistry);
    vi.mocked(systemdAvailable).mockReturnValue(false);
    vi.mocked(listContainers).mockReturnValue([]);
    const result = await statusCommand.run({}, makeCliContext());
    expect(result.ok).toBeTruthy();
    expect(result.render?.kind).toBe('table');
    expect(result.data).toHaveProperty('totalApps');
    expect(result.summary).toMatch(/apps/);
  });

  it('run projects each app into a table row', async () => {
    const app: AppEntry = {
      name: 'web',
      displayName: 'Web',
      composePath: '/srv/web',
      composeFile: null,
      serviceName: 'fleet-web',
      domains: [],
      port: null,
      usesSharedDb: false,
      type: 'proxy',
      containers: ['web-app'],
      dependsOnDatabases: false,
      registeredAt: '2026-01-01',
    };
    const registry: Registry = {
      version: 1,
      apps: [app],
      infrastructure: {
        databases: { serviceName: 'docker-databases', composePath: '' },
        nginx: { configPath: '/etc/nginx' },
      },
    };
    const container: ContainerInfo = {
      name: 'web-app',
      status: 'Up 3 hours',
      health: 'healthy',
      ports: '',
      image: 'web:latest',
      uptime: '3 hours',
    };
    vi.mocked(load).mockReturnValue(registry);
    vi.mocked(systemdAvailable).mockReturnValue(true);
    vi.mocked(getMultipleServiceStatuses).mockReturnValue(
      new Map([['fleet-web', { name: 'fleet-web', active: true, enabled: true, state: 'active', description: '' }]])
    );
    vi.mocked(listContainers).mockReturnValue([container]);

    const result = await statusCommand.run({}, makeCliContext());
    expect(result.render).toEqual({
      kind: 'table',
      columns: ['APP', 'SYSTEMD', 'CONTAINERS', 'HEALTH'],
      rows: [['web', 'active', '1/1', 'healthy']],
    });
    expect(result.summary).toBe('1 apps | 1 healthy | 0 unhealthy');
  });
});
