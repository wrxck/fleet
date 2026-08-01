import { describe, it, expect, vi, beforeEach } from 'vitest';

import { installServiceForApp } from './service-install';
import { load } from './registry';
import { readServiceFile, installServiceFile, enableService } from './systemd';

vi.mock('./registry.js', () => ({
  load: vi.fn(),
  findApp: vi.fn((reg: { apps: Array<{ name: string }> }, name: string) =>
    reg.apps.find(a => a.name === name)),
}));

vi.mock('./systemd.js', () => ({
  readServiceFile: vi.fn(),
  installServiceFile: vi.fn(),
  enableService: vi.fn(),
}));

// templates/systemd and validate stay REAL — the template output shape and the
// composeFile validation are part of what these tests pin down.

const mockLoad = vi.mocked(load);
const mockReadServiceFile = vi.mocked(readServiceFile);
const mockInstallServiceFile = vi.mocked(installServiceFile);
const mockEnableService = vi.mocked(enableService);

function makeApp(overrides = {}) {
  return {
    name: 'nutrition-staging', displayName: 'nutrition-staging',
    composePath: '/srv/nutrition', composeFile: 'docker-compose.staging.yml',
    serviceName: 'nutrition-staging', domains: [], port: null,
    usesSharedDb: false, type: 'service' as const, containers: ['nutrition-staging'],
    dependsOnDatabases: true, registeredAt: '2026-01-01T00:00:00.000Z',
  ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockLoad.mockReturnValue({ version: 1, apps: [makeApp()], infrastructure: { databases: { serviceName: 'docker-databases', composePath: '/db' }, nginx: { configPath: '/etc/nginx' } } } as never);
  mockReadServiceFile.mockReturnValue(null);
  mockEnableService.mockReturnValue(true);
});

describe('installServiceForApp — guard rails', () => {
  it('refuses an app that is not registered', () => {
    const result = installServiceForApp('ghost');
    expect(result.ok).toBeFalsy();
    expect(result.message).toMatch(/No registered app named 'ghost'/);
    expect(mockInstallServiceFile).not.toHaveBeenCalled();
  });

  it('refuses to overwrite an existing unit without force', () => {
    mockReadServiceFile.mockReturnValue('[Unit]\nDescription=already here');
    const result = installServiceForApp('nutrition-staging');
    expect(result.ok).toBeFalsy();
    expect(result.message).toMatch(/already exists/);
    expect(result.message).toMatch(/force/);
    expect(mockInstallServiceFile).not.toHaveBeenCalled();
    expect(mockEnableService).not.toHaveBeenCalled();
  });

  it('overwrites an existing unit when force is passed', () => {
    mockReadServiceFile.mockReturnValue('[Unit]\nDescription=already here');
    const result = installServiceForApp('nutrition-staging', { force: true });
    expect(result.ok).toBeTruthy();
    expect(mockInstallServiceFile).toHaveBeenCalled();
  });

  it('rejects a registry entry whose composeFile could inject unit directives', () => {
    mockLoad.mockReturnValue({
      version: 1,
      apps: [makeApp({ composeFile: 'evil.yml" --bad "x.yml' })],
      infrastructure: { databases: { serviceName: 'docker-databases', composePath: '/db' }, nginx: { configPath: '/etc/nginx' } },
    } as never);
    expect(() => installServiceForApp('nutrition-staging')).toThrow(/compose filename/);
    expect(mockInstallServiceFile).not.toHaveBeenCalled();
  });
});

describe('installServiceForApp — template output', () => {
  it('generates the unit from trusted registry fields and installs + enables it', () => {
    const result = installServiceForApp('nutrition-staging');
    expect(result.ok).toBeTruthy();
    expect(result.message).toMatch(/installed nutrition-staging\.service/);
    expect(result.message).toMatch(/enabled/);

    expect(mockInstallServiceFile).toHaveBeenCalledTimes(1);
    const [serviceName, content] = mockInstallServiceFile.mock.calls[0];
    expect(serviceName).toBe('nutrition-staging');
    expect(content).toContain('WorkingDirectory=/srv/nutrition');
    expect(content).toContain('-f "docker-compose.staging.yml"');
    expect(content).toContain('Requires=docker.service docker-databases.service');
    expect(content).toContain('ExecStart=/usr/bin/env fleet boot-start nutrition-staging');
    expect(content).toContain('WantedBy=multi-user.target');
    expect(result.unit).toBe(content);
    expect(mockEnableService).toHaveBeenCalledWith('nutrition-staging');
  });

  it('omits the -f flag and the database dependency when the registry says so', () => {
    mockLoad.mockReturnValue({
      version: 1,
      apps: [makeApp({ composeFile: null, dependsOnDatabases: false })],
      infrastructure: { databases: { serviceName: 'docker-databases', composePath: '/db' }, nginx: { configPath: '/etc/nginx' } },
    } as never);
    const result = installServiceForApp('nutrition-staging');
    expect(result.ok).toBeTruthy();
    const [, content] = mockInstallServiceFile.mock.calls[0];
    expect(content).not.toContain('-f "');
    expect(content).not.toContain('docker-databases.service');
  });

  it('still reports ok but flags it when systemctl enable fails', () => {
    mockEnableService.mockReturnValue(false);
    const result = installServiceForApp('nutrition-staging');
    expect(result.ok).toBeTruthy();
    expect(result.message).toMatch(/enable failed/);
  });
});
