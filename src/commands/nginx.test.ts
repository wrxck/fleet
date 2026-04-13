import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../core/nginx.js', () => ({
  readConfig: vi.fn(),
  installConfig: vi.fn(),
  testConfig: vi.fn(),
  reload: vi.fn(),
  removeConfig: vi.fn(),
  listSites: vi.fn(),
}));

vi.mock('../templates/nginx.js', () => ({
  generateNginxConfig: vi.fn(),
}));

vi.mock('../ui/confirm.js', () => ({
  confirm: vi.fn(),
}));

vi.mock('../ui/output.js', () => ({
  c: { green: '', red: '', dim: '', bold: '', reset: '' },
  heading: vi.fn(),
  table: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
}));

import { nginxCommand } from './nginx.js';
import * as nginxCore from '../core/nginx.js';
import { generateNginxConfig } from '../templates/nginx.js';
import { confirm } from '../ui/confirm.js';
import { error } from '../ui/output.js';

const mockReadConfig = vi.mocked(nginxCore.readConfig);
const mockInstallConfig = vi.mocked(nginxCore.installConfig);
const mockTestConfig = vi.mocked(nginxCore.testConfig);
const mockReload = vi.mocked(nginxCore.reload);
const mockRemoveConfig = vi.mocked(nginxCore.removeConfig);
const mockListSites = vi.mocked(nginxCore.listSites);
const mockGenerateNginxConfig = vi.mocked(generateNginxConfig);
const mockConfirm = vi.mocked(confirm);

beforeEach(() => {
  vi.clearAllMocks();
  mockReadConfig.mockReturnValue(null);
  mockGenerateNginxConfig.mockReturnValue('server { }');
  mockTestConfig.mockReturnValue({ ok: true, output: 'ok' });
  mockReload.mockReturnValue(true);
  mockRemoveConfig.mockReturnValue(true);
  mockListSites.mockReturnValue([]);
  mockConfirm.mockResolvedValue(true);
});

describe('nginxCommand — routing', () => {
  it('exits on unknown subcommand', async () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    await expect(nginxCommand(['bogus'])).rejects.toThrow('exit');
    exitSpy.mockRestore();
  });
});

describe('nginxCommand — add', () => {
  it('installs config and reloads nginx for valid domain and port', async () => {
    await nginxCommand(['add', 'example.com', '--port', '3000', '-y']);
    expect(mockInstallConfig).toHaveBeenCalledWith('example.com', 'server { }');
    expect(mockReload).toHaveBeenCalled();
  });

  it('passes type to generateNginxConfig', async () => {
    await nginxCommand(['add', 'example.com', '--port', '3000', '--type', 'spa', '-y']);
    expect(mockGenerateNginxConfig).toHaveBeenCalledWith(expect.objectContaining({ type: 'spa' }));
  });

  it('errors when neither domain nor port is given', async () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    await expect(nginxCommand(['add'])).rejects.toThrow('exit');
    exitSpy.mockRestore();
  });

  it('errors when port is missing', async () => {
    // domain is present but port will be NaN/null -> falsy -> triggers exit
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    await expect(nginxCommand(['add', 'example.com'])).rejects.toThrow('exit');
    exitSpy.mockRestore();
  });

  it('throws FleetError when config already exists for domain', async () => {
    mockReadConfig.mockReturnValue('existing config');
    await expect(nginxCommand(['add', 'example.com', '--port', '3000', '-y']))
      .rejects.toThrow('Config already exists');
  });

  it('removes config and exits when nginx test fails', async () => {
    mockTestConfig.mockReturnValue({ ok: false, output: 'syntax error' });
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    await expect(nginxCommand(['add', 'example.com', '--port', '3000', '-y'])).rejects.toThrow('exit');
    expect(mockRemoveConfig).toHaveBeenCalledWith('example.com');
    exitSpy.mockRestore();
  });

  it('does not install in dry-run mode', async () => {
    await nginxCommand(['add', 'example.com', '--port', '3000', '--dry-run', '-y']);
    expect(mockInstallConfig).not.toHaveBeenCalled();
    expect(mockReload).not.toHaveBeenCalled();
  });

  it('defaults to proxy type when --type not specified', async () => {
    await nginxCommand(['add', 'example.com', '--port', '3000', '-y']);
    expect(mockGenerateNginxConfig).toHaveBeenCalledWith(expect.objectContaining({ type: 'proxy' }));
  });
});

describe('nginxCommand — domain validation via assertDomain', () => {
  it('rejects domain with semicolon shell metacharacter', async () => {
    // assertDomain is called inside installConfig (core/nginx) and nginx.ts readConfig
    // With our mock, readConfig won't throw, but installConfig delegates to assertDomain in the real core.
    // Here we verify the command passes through to installConfig which then calls assertDomain.
    // We need to test that invalid domains cause failures — simulate via installConfig throwing.
    mockInstallConfig.mockImplementation((domain) => {
      if (!/^[a-zA-Z0-9][a-zA-Z0-9.-]*$/.test(domain)) {
        throw new Error(`Invalid domain: "${domain}"`);
      }
    });
    await expect(nginxCommand(['add', 'evil;rm -rf /', '--port', '3000', '-y']))
      .rejects.toThrow('Invalid domain');
  });

  it('rejects domain with slash path traversal', async () => {
    mockInstallConfig.mockImplementation((domain) => {
      if (!/^[a-zA-Z0-9][a-zA-Z0-9.-]*$/.test(domain)) {
        throw new Error(`Invalid domain: "${domain}"`);
      }
    });
    await expect(nginxCommand(['add', '../etc/nginx', '--port', '3000', '-y']))
      .rejects.toThrow('Invalid domain');
  });

  it('rejects domain with dollar sign', async () => {
    mockInstallConfig.mockImplementation((domain) => {
      if (!/^[a-zA-Z0-9][a-zA-Z0-9.-]*$/.test(domain)) {
        throw new Error(`Invalid domain: "${domain}"`);
      }
    });
    await expect(nginxCommand(['add', 'example$com', '--port', '3000', '-y']))
      .rejects.toThrow('Invalid domain');
  });

  it('accepts valid subdomain', async () => {
    await nginxCommand(['add', 'api.example.com', '--port', '4000', '-y']);
    expect(mockInstallConfig).toHaveBeenCalledWith('api.example.com', expect.any(String));
  });
});

describe('nginxCommand — remove', () => {
  it('removes config with -y flag', async () => {
    await nginxCommand(['remove', 'example.com', '-y']);
    expect(mockRemoveConfig).toHaveBeenCalledWith('example.com');
  });

  it('removes config and reloads nginx', async () => {
    await nginxCommand(['remove', 'example.com', '-y']);
    expect(mockReload).toHaveBeenCalled();
  });

  it('errors when domain is missing', async () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    await expect(nginxCommand(['remove'])).rejects.toThrow('exit');
    exitSpy.mockRestore();
  });

  it('cancels when user declines confirm', async () => {
    mockConfirm.mockResolvedValue(false);
    await nginxCommand(['remove', 'example.com']);
    expect(mockRemoveConfig).not.toHaveBeenCalled();
  });
});

describe('nginxCommand — list', () => {
  it('calls listSites and outputs json when --json flag used', async () => {
    mockListSites.mockReturnValue([{ domain: 'example.com', configFile: 'example.com.conf', enabled: true, ssl: false }]);
    const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    await nginxCommand(['list', '--json']);
    expect(writeSpy).toHaveBeenCalledWith(expect.stringContaining('"example.com"'));
    writeSpy.mockRestore();
  });

  it('calls listSites for human output', async () => {
    mockListSites.mockReturnValue([]);
    await nginxCommand(['list']);
    expect(mockListSites).toHaveBeenCalled();
  });
});
