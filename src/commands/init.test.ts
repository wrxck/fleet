import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('node:fs', async () => {
  const actual = await vi.importActual<typeof import('node:fs')>('node:fs');
  return { ...actual, existsSync: vi.fn(), readFileSync: vi.fn() };
});

vi.mock('../core/registry.js', () => ({
  load: vi.fn(),
  save: vi.fn(),
}));

vi.mock('../core/systemd.js', () => ({
  discoverServices: vi.fn(),
  parseServiceFile: vi.fn(),
  readServiceFile: vi.fn(),
}));

vi.mock('../core/docker.js', () => ({
  listContainers: vi.fn(),
  getContainersByCompose: vi.fn(),
}));

vi.mock('../core/nginx.js', () => ({
  listSites: vi.fn(),
  readConfig: vi.fn(),
  extractPortFromConfig: vi.fn(),
  extractDomainsFromConfig: vi.fn(),
}));

vi.mock('../ui/output.js', () => ({
  heading: vi.fn(),
  success: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
}));

import { load, save } from '../core/registry.js';
import { discoverServices, parseServiceFile, readServiceFile } from '../core/systemd.js';
import { listContainers, getContainersByCompose } from '../core/docker.js';
import { listSites } from '../core/nginx.js';
import { success, info } from '../ui/output.js';
import { initCommand } from './init.js';

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
});

describe('initCommand', () => {
  it('discovers and registers services', () => {
    vi.mocked(load).mockReturnValue({ apps: [] } as any);
    vi.mocked(discoverServices).mockReturnValue(['myapp']);
    vi.mocked(listContainers).mockReturnValue([]);
    vi.mocked(listSites).mockReturnValue([]);
    vi.mocked(readServiceFile).mockReturnValue('[Unit]\nDescription=MyApp Service\n[Service]\nWorkingDirectory=/opt/myapp\nExecStart=/usr/bin/docker compose up\n[Install]');
    vi.mocked(parseServiceFile).mockReturnValue({
      workingDirectory: '/opt/myapp', composeFile: null, dependsOnDatabases: false,
    });
    vi.mocked(getContainersByCompose).mockReturnValue(['myapp-web']);

    initCommand([]);

    expect(save).toHaveBeenCalled();
    expect(success).toHaveBeenCalled();
  });

  it('skips docker-databases service', () => {
    vi.mocked(load).mockReturnValue({ apps: [] } as any);
    vi.mocked(discoverServices).mockReturnValue(['docker-databases']);
    vi.mocked(listContainers).mockReturnValue([]);
    vi.mocked(listSites).mockReturnValue([]);

    initCommand([]);

    expect(info).toHaveBeenCalledWith(expect.stringContaining('Registered 0'));
  });

  it('outputs JSON when --json flag passed', () => {
    vi.mocked(load).mockReturnValue({ apps: [] } as any);
    vi.mocked(discoverServices).mockReturnValue([]);
    vi.mocked(listContainers).mockReturnValue([]);
    vi.mocked(listSites).mockReturnValue([]);

    initCommand(['--json']);

    expect(process.stdout.write).toHaveBeenCalled();
  });
});
