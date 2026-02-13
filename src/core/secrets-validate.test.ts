import { readFileSync, existsSync } from 'node:fs';

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('node:fs', () => ({
  readFileSync: vi.fn(),
  existsSync: vi.fn(),
}));

vi.mock('./secrets.js', () => ({
  loadManifest: vi.fn(),
}));

vi.mock('./registry.js', () => ({
  load: vi.fn(),
}));

import { loadManifest } from './secrets.js';
import { load } from './registry.js';
import { validateApp } from './secrets-validate.js';

const mockedReadFileSync = vi.mocked(readFileSync);
const mockedExistsSync = vi.mocked(existsSync);
const mockedLoadManifest = vi.mocked(loadManifest);
const mockedLoad = vi.mocked(load);

beforeEach(() => {
  vi.clearAllMocks();
  mockedLoad.mockReturnValue({
    version: 1,
    apps: [
      {
        name: 'myapp',
        displayName: 'My App',
        composePath: '/home/matt/myapp',
        composeFile: null,
        serviceName: 'myapp',
        domains: [],
        port: 3000,
        usesSharedDb: false,
        type: 'service',
        containers: ['myapp'],
        dependsOnDatabases: false,
        registeredAt: '2026-01-01T00:00:00.000Z',
      },
    ],
    infrastructure: {
      databases: { serviceName: 'docker-databases', composePath: '/home/matt/docker-databases' },
      nginx: { configPath: '/etc/nginx' },
    },
  });
});

const composeWithSecrets = `
services:
  myapp:
    image: myapp
secrets:
  db_password:
    file: ./secrets/db_password.txt
  api_key:
    file: ./secrets/api_key.txt
`;

const composeNoSecrets = `
services:
  myapp:
    image: myapp
    ports:
      - "3000:3000"
`;

describe('validateApp', () => {
  it('extracts secret names from compose secrets block', () => {
    mockedExistsSync.mockReturnValue(true);
    mockedReadFileSync.mockReturnValue(composeWithSecrets);
    mockedLoadManifest.mockReturnValue({
      apps: {
        myapp: { files: ['db_password.txt', 'api_key.txt'] },
      },
    });

    const result = validateApp('myapp');
    expect(result.ok).toBeTruthy();
    expect(result.missing).toEqual([]);
    expect(result.extra).toEqual([]);
  });

  it('detects missing secrets', () => {
    mockedExistsSync.mockReturnValue(true);
    mockedReadFileSync.mockReturnValue(composeWithSecrets);
    mockedLoadManifest.mockReturnValue({
      apps: {
        myapp: { files: ['db_password.txt'] },
      },
    });

    const result = validateApp('myapp');
    expect(result.ok).toBeFalsy();
    expect(result.missing).toEqual(['api_key']);
  });

  it('detects extra secrets in vault', () => {
    mockedExistsSync.mockReturnValue(true);
    mockedReadFileSync.mockReturnValue(composeWithSecrets);
    mockedLoadManifest.mockReturnValue({
      apps: {
        myapp: { files: ['db_password.txt', 'api_key.txt', 'extra_secret.txt'] },
      },
    });

    const result = validateApp('myapp');
    expect(result.ok).toBeTruthy();
    expect(result.extra).toEqual(['extra_secret']);
  });

  it('strips .txt extension for comparison', () => {
    mockedExistsSync.mockReturnValue(true);
    mockedReadFileSync.mockReturnValue(composeWithSecrets);
    mockedLoadManifest.mockReturnValue({
      apps: {
        myapp: { files: ['db_password.txt', 'api_key.txt'] },
      },
    });

    const result = validateApp('myapp');
    expect(result.ok).toBeTruthy();
  });

  it('returns ok for apps without secrets block', () => {
    mockedExistsSync.mockReturnValue(true);
    mockedReadFileSync.mockReturnValue(composeNoSecrets);
    mockedLoadManifest.mockReturnValue({ apps: {} });

    const result = validateApp('myapp');
    expect(result.ok).toBeTruthy();
    expect(result.missing).toEqual([]);
    expect(result.extra).toEqual([]);
  });

  it('returns error for unknown app', () => {
    const result = validateApp('nonexistent');
    expect(result.ok).toBeFalsy();
    expect(result.extra).toContain('App not found in registry');
  });
});
