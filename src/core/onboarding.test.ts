import { existsSync, readFileSync } from 'node:fs';

import { describe, it, expect, vi, beforeEach } from 'vitest';

import { checkApp, summarizeUnresolved } from './onboarding';
import { load } from './registry';
import { readServiceFile, getServiceStatus, systemdAvailable } from './systemd';
import { isInitialized, loadManifest, listSecrets } from './secrets';
import { listSites } from './nginx';
import { execSafe } from './exec';

vi.mock('node:fs', async () => {
  const actual = await vi.importActual<typeof import('node:fs')>('node:fs');
  return { ...actual, existsSync: vi.fn(), readFileSync: vi.fn() };
});

vi.mock('./registry.js', () => ({
  load: vi.fn(),
  findApp: vi.fn((reg: { apps: Array<{ name: string }> }, name: string) =>
    reg.apps.find(a => a.name === name)),
}));

vi.mock('./systemd.js', () => ({
  readServiceFile: vi.fn(),
  getServiceStatus: vi.fn(),
  systemdAvailable: vi.fn(),
}));

vi.mock('./secrets.js', () => ({
  isInitialized: vi.fn(),
  loadManifest: vi.fn(),
  listSecrets: vi.fn(),
  RUNTIME_DIR: '/run/fleet-secrets',
}));

vi.mock('./nginx.js', () => ({
  listSites: vi.fn(),
}));

vi.mock('./exec.js', () => ({
  execSafe: vi.fn(),
}));

const mockExistsSync = vi.mocked(existsSync);
const mockReadFileSync = vi.mocked(readFileSync);
const mockLoad = vi.mocked(load);
const mockReadServiceFile = vi.mocked(readServiceFile);
const mockGetServiceStatus = vi.mocked(getServiceStatus);
const mockSystemdAvailable = vi.mocked(systemdAvailable);
const mockIsInitialized = vi.mocked(isInitialized);
const mockLoadManifest = vi.mocked(loadManifest);
const mockListSecrets = vi.mocked(listSecrets);
const mockListSites = vi.mocked(listSites);
const mockExecSafe = vi.mocked(execSafe);

const COMPOSE_WITH_ARGS = [
  'services:',
  '  api:',
  '    build:',
  '      args:',
  '        - NPM_TOKEN=${NPM_TOKEN}',
  '',
].join('\n');

function makeApp(overrides = {}) {
  return {
    name: 'staging', displayName: 'staging', composePath: '/srv/app',
    composeFile: 'docker-compose.staging.yml', serviceName: 'staging',
    domains: [], port: null, usesSharedDb: false, type: 'service' as const,
    containers: ['staging'], dependsOnDatabases: false,
    registeredAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function makeRegistry(apps = [makeApp()]) {
  return {
    version: 1, apps,
    infrastructure: { databases: { serviceName: 'docker-databases', composePath: '/db' }, nginx: { configPath: '/etc/nginx' } },
  };
}

function check(rep: Awaited<ReturnType<typeof checkApp>>, id: string) {
  return rep.checks.find(ch => ch.id === id);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockLoad.mockReturnValue(makeRegistry());
  mockExistsSync.mockReturnValue(true);
  mockReadFileSync.mockReturnValue('services:\n  api:\n    image: x\n');
  mockReadServiceFile.mockReturnValue('[Unit]\nDescription=x');
  mockSystemdAvailable.mockReturnValue(true);
  mockGetServiceStatus.mockReturnValue({ name: 'staging', active: true, enabled: true, state: 'active', description: '' });
  mockIsInitialized.mockReturnValue(true);
  mockLoadManifest.mockReturnValue({ version: 1, apps: {} });
  mockListSecrets.mockReturnValue([]);
  mockListSites.mockReturnValue([]);
  mockExecSafe.mockReturnValue({ ok: true, stdout: '200', stderr: '', exitCode: 0 });
});

describe('checkApp — registry and compose', () => {
  it('reports a blocking missing registry entry for an unknown app', async () => {
    const rep = await checkApp('ghost');
    expect(rep.ok).toBeFalsy();
    expect(check(rep, 'registry')?.status).toBe('missing');
    expect(check(rep, 'registry')?.fix?.command).toMatch(/fleet_register/);
  });

  it('reports a blocking missing compose file when it is not on disk', async () => {
    mockExistsSync.mockImplementation((p: unknown) => String(p) === '/srv/app');
    const rep = await checkApp('staging');
    expect(rep.ok).toBeFalsy();
    expect(check(rep, 'compose')?.status).toBe('missing');
    expect(check(rep, 'compose')?.detail).toMatch(/docker-compose\.staging\.yml/);
  });

  it('passes everything for a plain app that needs nothing', async () => {
    const rep = await checkApp('staging');
    expect(rep.ok).toBeTruthy();
    expect(check(rep, 'unit')?.status).toBe('ok');
    expect(check(rep, 'vault')?.status).toBe('skip');
    expect(check(rep, 'runtime-env')?.status).toBe('skip');
  });
});

describe('checkApp — systemd unit', () => {
  it('flags a missing unit as blocking with the scaffolder fix', async () => {
    mockReadServiceFile.mockReturnValue(null);
    const rep = await checkApp('staging');
    expect(rep.ok).toBeFalsy();
    const unit = check(rep, 'unit');
    expect(unit?.status).toBe('missing');
    expect(unit?.blocking).toBeTruthy();
    expect(unit?.fix?.runner).toBe('mcp');
    expect(unit?.fix?.command).toMatch(/fleet_service_install/);
    expect(unit?.detail).toMatch(/sudo fleet service install staging/);
  });

  it('warns when the unit exists but is not enabled', async () => {
    mockGetServiceStatus.mockReturnValue({ name: 'staging', active: false, enabled: false, state: 'inactive', description: '' });
    const rep = await checkApp('staging');
    expect(check(rep, 'unit-enabled')?.status).toBe('warn');
    expect(check(rep, 'unit-enabled')?.fix?.command).toMatch(/systemctl enable/);
  });
});

describe('checkApp — vault and runtime env', () => {
  beforeEach(() => {
    mockReadFileSync.mockReturnValue(COMPOSE_WITH_ARGS);
    // runtime env file for the app does not exist; everything else does
    mockExistsSync.mockImplementation((p: unknown) => !String(p).startsWith('/run/fleet-secrets'));
  });

  it('flags a missing vault entry with a per-key operator-root seed command', async () => {
    const rep = await checkApp('staging');
    expect(rep.ok).toBeFalsy();
    expect(check(rep, 'vault')?.status).toBe('missing');
    const key = check(rep, 'vault-key:NPM_TOKEN');
    expect(key?.status).toBe('missing');
    expect(key?.fix?.runner).toBe('operator-root');
    expect(key?.fix?.command).toBe(`printf '%s' "$VALUE" | sudo fleet secrets set staging NPM_TOKEN --from-stdin`);
  });

  it('flags missing key NAMES when the entry exists but coverage is short', async () => {
    mockLoadManifest.mockReturnValue({ version: 1, apps: { staging: { type: 'env' } } } as never);
    mockListSecrets.mockReturnValue([{ key: 'OTHER_KEY', maskedValue: 'x***' }]);
    const rep = await checkApp('staging');
    expect(check(rep, 'vault')?.status).toBe('ok');
    expect(check(rep, 'vault-key:NPM_TOKEN')?.status).toBe('missing');
  });

  it('passes vault coverage when key names cover the compose vars', async () => {
    mockLoadManifest.mockReturnValue({ version: 1, apps: { staging: { type: 'env' } } } as never);
    mockListSecrets.mockReturnValue([{ key: 'NPM_TOKEN', maskedValue: 'n***' }]);
    const rep = await checkApp('staging');
    expect(check(rep, 'vault-keys')?.status).toBe('ok');
  });

  it('flags the missing runtime env file with the drift-first unseal fix', async () => {
    const rep = await checkApp('staging');
    const runtime = check(rep, 'runtime-env');
    expect(runtime?.status).toBe('missing');
    expect(runtime?.blocking).toBeTruthy();
    expect(runtime?.detail).toMatch(/fleet_secrets_drift first/);
    expect(runtime?.fix?.command).toBe('fleet_secrets_unseal');
  });

  it('reports the runtime env as ok when materialised', async () => {
    mockExistsSync.mockReturnValue(true);
    mockLoadManifest.mockReturnValue({ version: 1, apps: { staging: { type: 'env' } } } as never);
    mockListSecrets.mockReturnValue([{ key: 'NPM_TOKEN', maskedValue: 'n***' }]);
    const rep = await checkApp('staging');
    expect(check(rep, 'runtime-env')?.status).toBe('ok');
    expect(rep.ok).toBeTruthy();
  });
});

describe('checkApp — compose warnings', () => {
  it('warns on a host-port clash with another registered app', async () => {
    mockLoad.mockReturnValue(makeRegistry([
      makeApp(),
      makeApp({ name: 'other', composePath: '/srv/other', composeFile: null, port: 3007 }),
    ]));
    mockReadFileSync.mockReturnValue('services:\n  web:\n    ports:\n      - "3007:3000"\n');
    const rep = await checkApp('staging');
    expect(check(rep, 'port-clash')?.status).toBe('warn');
    expect(check(rep, 'port-clash')?.detail).toMatch(/3007 \(used by other\)/);
  });

  it('warns when a sibling app shares the composePath and no explicit name exists', async () => {
    mockLoad.mockReturnValue(makeRegistry([
      makeApp(),
      makeApp({ name: 'prod', composeFile: null }),
    ]));
    const rep = await checkApp('staging');
    expect(check(rep, 'project-name')?.status).toBe('warn');
    expect(check(rep, 'project-name')?.detail).toMatch(/tears down the other/);
  });

  it('does not warn when the shared-path compose declares an explicit name', async () => {
    mockLoad.mockReturnValue(makeRegistry([
      makeApp(),
      makeApp({ name: 'prod', composeFile: null }),
    ]));
    mockReadFileSync.mockReturnValue('name: staging-proj\nservices:\n  api:\n    image: x\n');
    const rep = await checkApp('staging');
    expect(check(rep, 'project-name')?.status).toBe('ok');
  });
});

describe('checkApp — nginx and port', () => {
  it('flags a missing nginx conf per domain with the mcp fix', async () => {
    mockLoad.mockReturnValue(makeRegistry([makeApp({ domains: ['staging.example.com'], port: 3009 })]));
    const rep = await checkApp('staging');
    const ng = check(rep, 'nginx:staging.example.com');
    expect(ng?.status).toBe('missing');
    expect(ng?.blocking).toBeFalsy();
    expect(ng?.fix?.command).toMatch(/fleet_nginx_add/);
    expect(ng?.fix?.command).toMatch(/3009/);
  });

  it('reports ok for an enabled conf and warn for a disabled one', async () => {
    mockLoad.mockReturnValue(makeRegistry([makeApp({ domains: ['a.example.com', 'b.example.com'], port: 3009 })]));
    mockListSites.mockReturnValue([
      { domain: 'a.example.com', configFile: 'a.example.com.conf', enabled: true, ssl: true },
      { domain: 'b.example.com', configFile: 'b.example.com.conf', enabled: false, ssl: false },
    ]);
    const rep = await checkApp('staging');
    expect(check(rep, 'nginx:a.example.com')?.status).toBe('ok');
    expect(check(rep, 'nginx:b.example.com')?.status).toBe('warn');
  });

  it('never blocks on the port check — a silent port is only a warn', async () => {
    mockLoad.mockReturnValue(makeRegistry([makeApp({ port: 3009 })]));
    mockExecSafe.mockReturnValue({ ok: false, stdout: '000', stderr: '', exitCode: 7 });
    const rep = await checkApp('staging');
    expect(check(rep, 'port')?.status).toBe('warn');
    expect(rep.ok).toBeTruthy();
  });
});

describe('summarizeUnresolved', () => {
  it('lists only missing/warn checks with their fix runner and command', async () => {
    mockReadServiceFile.mockReturnValue(null);
    const rep = await checkApp('staging');
    const lines = summarizeUnresolved(rep);
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.join('\n')).toMatch(/\[missing\] Systemd unit/);
    expect(lines.join('\n')).toMatch(/mcp: fleet_service_install/);
    expect(lines.join('\n')).not.toMatch(/\[ok\]/);
  });
});
