import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../core/registry.js', () => ({
  load: vi.fn(),
}));

import { load } from '../core/registry.js';
import { generateUnsealService } from './unseal.js';
import type { Registry, AppEntry } from '../core/registry.js';

const mockLoad = vi.mocked(load);

function makeApp(overrides: Partial<AppEntry> = {}): AppEntry {
  return {
    name: 'myapp',
    displayName: 'My App',
    composePath: '/opt/apps/myapp',
    composeFile: null,
    serviceName: 'myapp',
    domains: [],
    port: 3000,
    usesSharedDb: false,
    type: 'service',
    containers: ['myapp'],
    dependsOnDatabases: false,
    registeredAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function makeRegistry(apps: AppEntry[] = []): Registry {
  return {
    version: 1,
    apps,
    infrastructure: {
      databases: { serviceName: 'docker-databases', composePath: '/opt/databases' },
      nginx: { configPath: '/etc/nginx' },
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('generateUnsealService', () => {
  it('generates a valid systemd unit file structure', () => {
    mockLoad.mockReturnValue(makeRegistry([]));
    const result = generateUnsealService();
    expect(result).toContain('[Unit]');
    expect(result).toContain('[Service]');
    expect(result).toContain('[Install]');
  });

  it('has correct unit description', () => {
    mockLoad.mockReturnValue(makeRegistry([]));
    const result = generateUnsealService();
    expect(result).toContain('Description=Fleet Secrets Unseal');
  });

  it('starts After=local-fs.target', () => {
    mockLoad.mockReturnValue(makeRegistry([]));
    const result = generateUnsealService();
    expect(result).toContain('After=local-fs.target');
  });

  it('includes docker-databases.service in Before= directive', () => {
    mockLoad.mockReturnValue(makeRegistry([]));
    const result = generateUnsealService();
    expect(result).toContain('docker-databases.service');
    // It should be in the Before= line
    const beforeLine = result.split('\n').find(l => l.startsWith('Before='));
    expect(beforeLine).toBeDefined();
    expect(beforeLine).toContain('docker-databases.service');
  });

  it('lists app services in Before= directive', () => {
    const apps = [
      makeApp({ serviceName: 'app-one' }),
      makeApp({ name: 'app-two', serviceName: 'app-two' }),
    ];
    mockLoad.mockReturnValue(makeRegistry(apps));
    const result = generateUnsealService();
    const beforeLine = result.split('\n').find(l => l.startsWith('Before='));
    expect(beforeLine).toContain('app-one.service');
    expect(beforeLine).toContain('app-two.service');
  });

  it('ExecStart uses node to run the fleet binary', () => {
    mockLoad.mockReturnValue(makeRegistry([]));
    const result = generateUnsealService();
    expect(result).toContain('ExecStart=/usr/bin/node ');
    expect(result).toContain('secrets unseal');
  });

  it('fleet binary path ends at dist/index.js', () => {
    mockLoad.mockReturnValue(makeRegistry([]));
    const result = generateUnsealService();
    const execLine = result.split('\n').find(l => l.startsWith('ExecStart='));
    expect(execLine).toBeDefined();
    expect(execLine).toMatch(/dist\/index\.js secrets unseal/);
  });

  it('ExecStop removes runtime secrets directory', () => {
    mockLoad.mockReturnValue(makeRegistry([]));
    const result = generateUnsealService();
    expect(result).toContain('ExecStop=/bin/rm -rf /run/fleet-secrets');
  });

  it('is oneshot with RemainAfterExit', () => {
    mockLoad.mockReturnValue(makeRegistry([]));
    const result = generateUnsealService();
    expect(result).toContain('Type=oneshot');
    expect(result).toContain('RemainAfterExit=yes');
  });

  it('has TimeoutStartSec', () => {
    mockLoad.mockReturnValue(makeRegistry([]));
    const result = generateUnsealService();
    expect(result).toContain('TimeoutStartSec=30');
  });

  it('is installed to multi-user.target', () => {
    mockLoad.mockReturnValue(makeRegistry([]));
    const result = generateUnsealService();
    expect(result).toContain('WantedBy=multi-user.target');
  });

  it('works with empty app list', () => {
    mockLoad.mockReturnValue(makeRegistry([]));
    const result = generateUnsealService();
    const beforeLine = result.split('\n').find(l => l.startsWith('Before='));
    // Only the database service, no app services
    expect(beforeLine).toBe('Before=docker-databases.service');
  });

  it('uses custom database serviceName from registry infrastructure', () => {
    const reg = makeRegistry([]);
    reg.infrastructure.databases.serviceName = 'custom-databases';
    mockLoad.mockReturnValue(reg);
    const result = generateUnsealService();
    expect(result).toContain('custom-databases.service');
  });

  it('calls load() exactly once', () => {
    mockLoad.mockReturnValue(makeRegistry([]));
    generateUnsealService();
    expect(mockLoad).toHaveBeenCalledTimes(1);
  });
});
