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

import { load } from '../core/registry';
import type { Registry } from '../core/registry';
import { systemdAvailable, getMultipleServiceStatuses } from '../core/systemd';
import { listContainers } from '../core/docker';
import { loadRegistry } from './index';
import { getCommand } from './registry';
import { collectRegistryTools } from '../mcp/registry-bridge';
import { dispatchRegistryCommand } from '../cli';

const emptyRegistry: Registry = {
  version: 1,
  apps: [],
  infrastructure: {
    databases: { serviceName: 'docker-databases', composePath: '' },
    nginx: { configPath: '/etc/nginx' },
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(load).mockReturnValue(emptyRegistry);
  vi.mocked(systemdAvailable).mockReturnValue(false);
  vi.mocked(getMultipleServiceStatuses).mockReturnValue(new Map());
  vi.mocked(listContainers).mockReturnValue([]);
});

describe('phase 1 parity — status', () => {
  it('status is in the registry', () => {
    loadRegistry();
    expect(getCommand('status')).toBeDefined();
  });

  it('status is exposed as an mcp tool', () => {
    expect(collectRegistryTools().some(t => t.toolName === 'fleet_status')).toBeTruthy();
  });

  it('status is runnable through the cli dispatcher', async () => {
    const handled = await dispatchRegistryCommand('status', [], () => {});
    expect(handled).toBeTruthy();
  });

  it('status has a rich tui view', () => {
    loadRegistry();
    expect(getCommand('status')?.tui).toEqual({ view: 'dashboard' });
  });
});
