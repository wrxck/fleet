import { existsSync, readFileSync } from 'node:fs';

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { preflightDeploy, formatPreflightFailures } from './deploy-preflight';
import { readServiceFile } from './systemd';
import { isInitialized, loadManifest } from './secrets';
import type { AppEntry } from './registry';

vi.mock('node:fs', async () => {
  const actual = await vi.importActual<typeof import('node:fs')>('node:fs');
  return { ...actual, existsSync: vi.fn(), readFileSync: vi.fn() };
});

vi.mock('./systemd.js', () => ({
  readServiceFile: vi.fn(),
}));

vi.mock('./secrets.js', () => ({
  isInitialized: vi.fn(),
  loadManifest: vi.fn(),
  RUNTIME_DIR: '/run/fleet-secrets',
}));

const mockExistsSync = vi.mocked(existsSync);
const mockReadFileSync = vi.mocked(readFileSync);
const mockReadServiceFile = vi.mocked(readServiceFile);
const mockIsInitialized = vi.mocked(isInitialized);
const mockLoadManifest = vi.mocked(loadManifest);

const COMPOSE_PLAIN = 'services:\n  web:\n    image: nginx\n';
const COMPOSE_BUILD_ARG = [
  'services:',
  '  api:',
  '    build:',
  '      args:',
  '        - NPM_TOKEN=${NPM_TOKEN}',
  '',
].join('\n');

function makeApp(overrides: Partial<AppEntry> = {}): AppEntry {
  return {
    name: 'staging', displayName: 'staging', composePath: '/srv/app',
    composeFile: 'docker-compose.staging.yml', serviceName: 'staging',
    domains: [], port: null, usesSharedDb: false, type: 'service',
    containers: ['staging'], dependsOnDatabases: false,
    registeredAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockExistsSync.mockReturnValue(true);
  mockReadFileSync.mockReturnValue(COMPOSE_PLAIN);
  mockReadServiceFile.mockReturnValue('[Unit]\nDescription=x');
  mockIsInitialized.mockReturnValue(true);
  mockLoadManifest.mockReturnValue({ version: 1, apps: {} });
});

afterEach(() => {
  delete process.env.NPM_TOKEN;
});

describe('preflightDeploy — no-regression cases', () => {
  it('passes a plain app whose compose requires nothing, even with no vault entry', () => {
    const pre = preflightDeploy(makeApp());
    expect(pre.ok).toBeTruthy();
    expect(pre.failures).toEqual([]);
  });

  it('passes when required vars exist but the vault entry and runtime env are present', () => {
    mockReadFileSync.mockReturnValue(COMPOSE_BUILD_ARG);
    mockLoadManifest.mockReturnValue({ version: 1, apps: { staging: { type: 'env' } } } as never);
    const pre = preflightDeploy(makeApp());
    expect(pre.ok).toBeTruthy();
  });

  it('passes bare non-build-arg vars — they resolve to empty, not certain failure', () => {
    mockReadFileSync.mockReturnValue('services:\n  w:\n    environment:\n      - X=${MAYBE}\n');
    mockExistsSync.mockImplementation((p: unknown) => !String(p).startsWith('/run/fleet-secrets'));
    const pre = preflightDeploy(makeApp());
    expect(pre.ok).toBeTruthy();
  });

  it('passes when the blocking vars are supplied by the process environment', () => {
    process.env.NPM_TOKEN = 'from-env';
    mockReadFileSync.mockReturnValue(COMPOSE_BUILD_ARG);
    mockExistsSync.mockImplementation((p: unknown) => !String(p).startsWith('/run/fleet-secrets'));
    const pre = preflightDeploy(makeApp());
    expect(pre.ok).toBeTruthy();
  });

  it('never blocks when a check itself blows up', () => {
    mockReadServiceFile.mockImplementation(() => { throw new Error('systemd unreachable'); });
    mockReadFileSync.mockImplementation(() => { throw new Error('unreadable'); });
    const pre = preflightDeploy(makeApp());
    expect(pre.ok).toBeTruthy();
  });
});

describe('preflightDeploy — certain-failure blocks', () => {
  it('blocks when the systemd unit is missing, with the scaffolder fix', () => {
    mockReadServiceFile.mockReturnValue(null);
    const pre = preflightDeploy(makeApp());
    expect(pre.ok).toBeFalsy();
    expect(pre.failures[0].id).toBe('unit');
    expect(pre.failures[0].fix?.command).toMatch(/fleet_service_install/);
  });

  it('blocks a build-arg compose with no vault entry AND no runtime env, with both fixes', () => {
    mockReadFileSync.mockReturnValue(COMPOSE_BUILD_ARG);
    mockExistsSync.mockImplementation((p: unknown) => !String(p).startsWith('/run/fleet-secrets'));
    const pre = preflightDeploy(makeApp());
    expect(pre.ok).toBeFalsy();
    const ids = pre.failures.map(f => f.id);
    expect(ids).toContain('vault');
    expect(ids).toContain('runtime-env');
    const vault = pre.failures.find(f => f.id === 'vault');
    expect(vault?.fix?.runner).toBe('operator-root');
    expect(vault?.fix?.command).toMatch(/--from-stdin/);
    expect(vault?.fix?.command).not.toMatch(/NPM_TOKEN=\S/);
    const runtime = pre.failures.find(f => f.id === 'runtime-env');
    expect(runtime?.detail).toMatch(/fleet_secrets_drift first/);
    expect(runtime?.fix?.command).toBe('fleet_secrets_unseal');
  });

  it('blocks a seeded-but-never-unsealed vault (runtime env missing)', () => {
    mockReadFileSync.mockReturnValue(COMPOSE_BUILD_ARG);
    mockLoadManifest.mockReturnValue({ version: 1, apps: { staging: { type: 'env' } } } as never);
    mockExistsSync.mockImplementation((p: unknown) => !String(p).startsWith('/run/fleet-secrets'));
    const pre = preflightDeploy(makeApp());
    expect(pre.ok).toBeFalsy();
    expect(pre.failures.map(f => f.id)).toEqual(['runtime-env']);
  });

  it('blocks strict ${VAR:?} interpolations the same way', () => {
    mockReadFileSync.mockReturnValue('services:\n  w:\n    environment:\n      - K=${API_KEY:?required}\n');
    mockExistsSync.mockImplementation((p: unknown) => !String(p).startsWith('/run/fleet-secrets'));
    const pre = preflightDeploy(makeApp());
    expect(pre.ok).toBeFalsy();
    expect(pre.failures.find(f => f.id === 'vault')?.detail).toMatch(/API_KEY/);
  });
});

describe('formatPreflightFailures', () => {
  it('renders one line per failure with the fix runner and command', () => {
    mockReadServiceFile.mockReturnValue(null);
    const lines = formatPreflightFailures(preflightDeploy(makeApp()));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/\[unit\]/);
    expect(lines[0]).toMatch(/fix \(mcp\): fleet_service_install/);
  });
});
