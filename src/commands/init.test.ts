import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('node:fs', () => ({
  existsSync: vi.fn().mockReturnValue(false),
  readFileSync: vi.fn().mockReturnValue(''),
}));

vi.mock('../core/registry', async () => {
  const actual = await vi.importActual<typeof import('../core/registry')>('../core/registry');
  return { ...actual, load: vi.fn(), withRegistry: vi.fn() };
});

vi.mock('../core/systemd', () => ({
  discoverServices: vi.fn(),
  parseServiceFile: vi.fn(),
  readServiceFile: vi.fn(),
}));

vi.mock('../core/docker', () => ({
  listContainers: vi.fn(),
  getContainersByCompose: vi.fn(),
}));

vi.mock('../core/nginx', () => ({
  listSites: vi.fn(),
  readConfig: vi.fn(),
  extractPortFromConfig: vi.fn(),
  extractDomainsFromConfig: vi.fn(),
}));

import type { Registry, AppEntry } from '../core/registry';
import { load, withRegistry } from '../core/registry';
import { discoverServices, parseServiceFile, readServiceFile } from '../core/systemd';
import { listContainers, getContainersByCompose } from '../core/docker';
import { listSites } from '../core/nginx';
import { initCommand } from './init';
import { makeCliContext } from '../registry/context';

/** builds a minimal valid registry for use in tests. */
function makeRegistry(apps: AppEntry[] = []): Registry {
  return {
    version: 1,
    apps,
    infrastructure: {
      databases: { serviceName: 'docker-databases', composePath: '' },
      nginx: { configPath: '/etc/nginx' },
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  // default: withRegistry runs the callback immediately with an empty registry
  vi.mocked(withRegistry).mockImplementation(async (cb) => {
    const reg = makeRegistry();
    cb(reg);
  });
  vi.mocked(load).mockReturnValue(makeRegistry());
  vi.mocked(listContainers).mockReturnValue([]);
  vi.mocked(listSites).mockReturnValue([]);
  vi.mocked(getContainersByCompose).mockReturnValue([]);
});

describe('init CommandDef — metadata', () => {
  it('has the correct name', () => {
    expect(initCommand.name).toBe('init');
  });

  it('has a non-empty summary', () => {
    expect(initCommand.summary.length).toBeGreaterThan(0);
  });

  it('is not marked as destructive', () => {
    expect(initCommand.destructive).toBeFalsy();
  });
});

describe('init CommandDef — empty fleet', () => {
  it('returns ok with a Registry as data and a table render', async () => {
    vi.mocked(discoverServices).mockReturnValue([]);

    const result = await initCommand.run({}, makeCliContext());

    expect(result.ok).toBeTruthy();
    expect(result.data).toHaveProperty('apps');
    expect(result.summary).toMatch(/0 apps/);
    expect(result.render?.kind).toBe('table');
  });

  it('render has the expected columns', async () => {
    vi.mocked(discoverServices).mockReturnValue([]);

    const result = await initCommand.run({}, makeCliContext());

    if (result.render?.kind === 'table') {
      expect(result.render.columns).toEqual(['NAME', 'PATH', 'TYPE', 'PORT']);
    }
  });

  it('render rows is empty for an empty fleet', async () => {
    vi.mocked(discoverServices).mockReturnValue([]);

    const result = await initCommand.run({}, makeCliContext());

    if (result.render?.kind === 'table') {
      expect(result.render.rows).toHaveLength(0);
    }
  });
});

describe('init CommandDef — one discovered service', () => {
  beforeEach(() => {
    // withRegistry runs the callback with a fresh registry and surfaces it via load()
    vi.mocked(withRegistry).mockImplementation(async (cb) => {
      const reg = makeRegistry();
      cb(reg);
      vi.mocked(load).mockReturnValue(reg);
    });
    vi.mocked(discoverServices).mockReturnValue(['web']);
    vi.mocked(readServiceFile).mockReturnValue('[Unit]\nDescription=Web Service Docker\n');
    vi.mocked(parseServiceFile).mockReturnValue({
      workingDirectory: '/srv/web',
      composeFile: null,
      dependsOnDatabases: false,
    });
    vi.mocked(getContainersByCompose).mockReturnValue(['web']);
  });

  it('returns ok', async () => {
    const result = await initCommand.run({}, makeCliContext());
    expect(result.ok).toBeTruthy();
  });

  it('summary indicates 1 app registered', async () => {
    const result = await initCommand.run({}, makeCliContext());
    expect(result.summary).toMatch(/1 app\b/);
  });

  it('data contains a Registry (has apps array)', async () => {
    const result = await initCommand.run({}, makeCliContext());
    expect(result.data).toHaveProperty('apps');
    expect(Array.isArray((result.data as Registry).apps)).toBeTruthy();
  });

  it('discovered app appears in the render rows', async () => {
    const result = await initCommand.run({}, makeCliContext());

    if (result.render?.kind === 'table') {
      const names = result.render.rows.map(r => r[0]);
      expect(names).toContain('web');
    }
  });
});

describe('init CommandDef — skip list', () => {
  it('does not register docker-databases', async () => {
    vi.mocked(discoverServices).mockReturnValue(['docker-databases']);

    const result = await initCommand.run({}, makeCliContext());

    expect(result.ok).toBeTruthy();
    expect(result.summary).toMatch(/0 apps/);
  });
});
