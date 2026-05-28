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
    const out: string[] = [];
    const handled = await dispatchRegistryCommand('status', [], s => out.push(s));
    expect(handled).toBeTruthy();
    // the dispatcher must actually run status and render its table — not merely
    // recognise the command name.
    expect(out.join('')).toContain('APP');
  });

  it('status has a rich tui view', () => {
    loadRegistry();
    expect(getCommand('status')?.tui).toEqual({ view: 'dashboard' });
  });
});

describe('phase 2 parity', () => {
  const registryCommands = [
    'list', 'start', 'stop', 'restart', 'health', 'freeze', 'unfreeze',
    'rollback', 'add', 'remove', 'init', 'patch-systemd',
  ];

  it('every migrated command is in the registry', () => {
    loadRegistry();
    for (const name of registryCommands) {
      expect(getCommand(name), name).toBeDefined();
    }
  });

  it('every non-cliOnly migrated command is exposed as an mcp tool', () => {
    const tools = collectRegistryTools();
    for (const name of registryCommands) {
      const tool = 'fleet_' + name.replace(/:/g, '_');
      expect(tools.some(t => t.toolName === tool), tool).toBeTruthy();
    }
  });

  it('cliOnly commands are registered but excluded from mcp', () => {
    loadRegistry();
    expect(getCommand('boot-start')?.cliOnly).toBeTruthy();
    expect(getCommand('install-mcp')?.cliOnly).toBeTruthy();
    const tools = collectRegistryTools();
    expect(tools.some(t => t.toolName === 'fleet_boot-start')).toBeFalsy();
    expect(tools.some(t => t.toolName === 'fleet_install-mcp')).toBeFalsy();
  });

  it('health carries its rich tui view', () => {
    loadRegistry();
    expect(getCommand('health')?.tui).toEqual({ view: 'health' });
  });
});
