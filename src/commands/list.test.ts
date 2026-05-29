import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../core/registry', () => ({ load: vi.fn() }));

import type { Registry, AppEntry } from '../core/registry';
import { load } from '../core/registry';
import { listCommand } from './list';
import { makeCliContext } from '../registry/context';

function app(name: string): AppEntry {
  return {
    name, displayName: name, composePath: `/srv/${name}`, composeFile: null,
    serviceName: `fleet-${name}`, domains: [], port: null, usesSharedDb: false,
    type: 'service', containers: [], dependsOnDatabases: false, registeredAt: '2026-01-01',
  };
}
function registry(apps: AppEntry[]): Registry {
  return {
    version: 1, apps,
    infrastructure: { databases: { serviceName: 'docker-databases', composePath: '' }, nginx: { configPath: '/etc/nginx' } },
  };
}

beforeEach(() => vi.clearAllMocks());

describe('list CommandDef', () => {
  it('has registry metadata', () => {
    expect(listCommand.name).toBe('list');
  });

  it('run returns a table of registered apps', async () => {
    vi.mocked(load).mockReturnValue(registry([app('web'), app('api')]));
    const result = await listCommand.run({}, makeCliContext());
    expect(result.ok).toBeTruthy();
    expect(result.render?.kind).toBe('table');
    expect(result.data).toHaveLength(2);
    expect(result.summary).toMatch(/2/);
  });

  it('run reports an empty registry without failing', async () => {
    vi.mocked(load).mockReturnValue(registry([]));
    const result = await listCommand.run({}, makeCliContext());
    expect(result.ok).toBeTruthy();
    expect(result.data).toHaveLength(0);
  });
});
