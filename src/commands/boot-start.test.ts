import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as registry from '../core/registry.js';
import * as refreshModule from '../core/boot-refresh.js';
import * as docker from '../core/docker.js';
import { bootStartCommand } from './boot-start.js';

vi.mock('../core/registry.js');
vi.mock('../core/boot-refresh.js');
vi.mock('../core/docker.js');

const baseApp = {
  name: 'x',
  displayName: 'x',
  composePath: '/tmp/x',
  composeFile: null,
  serviceName: 'x',
  domains: [],
  port: null,
  usesSharedDb: false,
  type: 'service' as const,
  containers: [],
  dependsOnDatabases: false,
  registeredAt: '',
};

function stubRegistry() {
  vi.mocked(registry.load).mockReturnValue({
    version: 1,
    apps: [baseApp],
    infrastructure: {
      databases: { serviceName: '', composePath: '' },
      nginx: { configPath: '' },
    },
  });
  // findApp is also from registry.js — mock it to look up by name
  vi.mocked(registry.findApp).mockImplementation((reg, name) =>
    reg.apps.find(a => a.name === name || a.serviceName === name)
  );
}

describe('bootStartCommand', () => {
  beforeEach(() => vi.resetAllMocks());

  it('exits 1 when no app arg given', async () => {
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => { throw new Error('exit'); }) as never);
    await expect(bootStartCommand([])).rejects.toThrow('exit');
    expect(exit).toHaveBeenCalledWith(1);
  });

  it('exits 1 when app not found in registry', async () => {
    vi.mocked(registry.load).mockReturnValue({
      version: 1, apps: [],
      infrastructure: { databases: { serviceName: '', composePath: '' }, nginx: { configPath: '' } },
    });
    vi.mocked(registry.findApp).mockReturnValue(undefined);
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => { throw new Error('exit'); }) as never);
    await expect(bootStartCommand(['ghost'])).rejects.toThrow('exit');
    expect(exit).toHaveBeenCalledWith(1);
  });

  it('calls compose up even when refresh returns failed-safe', async () => {
    stubRegistry();
    vi.mocked(refreshModule.refresh).mockResolvedValue({ kind: 'failed-safe', step: 'fetch', detail: 'no network' });
    vi.mocked(docker.composeUp).mockReturnValue(true);
    await bootStartCommand(['x']);
    expect(docker.composeUp).toHaveBeenCalledWith('/tmp/x', null);
  });

  it('calls compose up even when refresh throws (safety net)', async () => {
    stubRegistry();
    vi.mocked(refreshModule.refresh).mockRejectedValue(new Error('boom'));
    vi.mocked(docker.composeUp).mockReturnValue(true);
    await bootStartCommand(['x']);
    expect(docker.composeUp).toHaveBeenCalled();
  });

  it('calls compose up when refresh returns refreshed', async () => {
    stubRegistry();
    vi.mocked(refreshModule.refresh).mockResolvedValue({ kind: 'refreshed', head: 'abc', built: true });
    vi.mocked(docker.composeUp).mockReturnValue(true);
    await bootStartCommand(['x']);
    expect(docker.composeUp).toHaveBeenCalledWith('/tmp/x', null);
  });

  it('calls compose up when refresh returns skipped', async () => {
    stubRegistry();
    vi.mocked(refreshModule.refresh).mockResolvedValue({ kind: 'skipped', reason: 'kill-switch' });
    vi.mocked(docker.composeUp).mockReturnValue(true);
    await bootStartCommand(['x']);
    expect(docker.composeUp).toHaveBeenCalledWith('/tmp/x', null);
  });

  it('calls compose up when refresh returns no-change', async () => {
    stubRegistry();
    vi.mocked(refreshModule.refresh).mockResolvedValue({ kind: 'no-change', head: 'abc' });
    vi.mocked(docker.composeUp).mockReturnValue(true);
    await bootStartCommand(['x']);
    expect(docker.composeUp).toHaveBeenCalledWith('/tmp/x', null);
  });

  it('exits 1 when compose up fails', async () => {
    stubRegistry();
    vi.mocked(refreshModule.refresh).mockResolvedValue({ kind: 'no-change', head: 'abc' });
    vi.mocked(docker.composeUp).mockReturnValue(false);
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => { throw new Error('exit'); }) as never);
    await expect(bootStartCommand(['x'])).rejects.toThrow('exit');
    expect(exit).toHaveBeenCalledWith(1);
  });

  it('passes composeFile when app has one', async () => {
    vi.mocked(registry.load).mockReturnValue({
      version: 1,
      apps: [{ ...baseApp, composeFile: 'docker-compose.prod.yml' }],
      infrastructure: { databases: { serviceName: '', composePath: '' }, nginx: { configPath: '' } },
    });
    vi.mocked(registry.findApp).mockImplementation((reg, name) =>
      reg.apps.find(a => a.name === name)
    );
    vi.mocked(refreshModule.refresh).mockResolvedValue({ kind: 'no-change', head: 'abc' });
    vi.mocked(docker.composeUp).mockReturnValue(true);
    await bootStartCommand(['x']);
    expect(docker.composeUp).toHaveBeenCalledWith('/tmp/x', 'docker-compose.prod.yml');
  });
});
