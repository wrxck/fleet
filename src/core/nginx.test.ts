import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('node:fs', () => ({
  existsSync: vi.fn(),
  readdirSync: vi.fn(),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  unlinkSync: vi.fn(),
}));

vi.mock('./exec.js', () => ({
  execSafe: vi.fn(),
}));

vi.mock('./validate.js', () => ({
  assertDomain: vi.fn(),
}));

import { existsSync, readdirSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { execSafe } from './exec.js';
import { assertDomain } from './validate.js';
import {
  listSites,
  installConfig,
  removeConfig,
  testConfig,
  reload,
  readConfig,
  extractPortFromConfig,
  extractDomainsFromConfig,
} from './nginx.js';

const mockExistsSync = vi.mocked(existsSync);
const mockReaddirSync = vi.mocked(readdirSync);
const mockReadFileSync = vi.mocked(readFileSync);
const mockWriteFileSync = vi.mocked(writeFileSync);
const mockUnlinkSync = vi.mocked(unlinkSync);
const mockExecSafe = vi.mocked(execSafe);
const mockAssertDomain = vi.mocked(assertDomain);

beforeEach(() => {
  vi.clearAllMocks();
});

describe('listSites', () => {
  it('returns empty array when sites-available does not exist', () => {
    mockExistsSync.mockReturnValue(false);
    expect(listSites()).toEqual([]);
  });

  it('lists conf files from sites-available', () => {
    mockExistsSync.mockImplementation((p) => {
      if (String(p) === '/etc/nginx/sites-available') return true;
      if (String(p).includes('sites-enabled')) return false;
      return false;
    });
    mockReaddirSync.mockReturnValue(['app.conf', 'other.conf', 'default.conf'] as any);
    mockReadFileSync.mockReturnValue('server { listen 80; }');

    const sites = listSites();
    // default.conf is excluded
    expect(sites).toHaveLength(2);
    expect(sites.map(s => s.domain)).toContain('app');
    expect(sites.map(s => s.domain)).toContain('other');
  });

  it('marks site as enabled when symlink exists in sites-enabled', () => {
    mockExistsSync.mockImplementation((p) => {
      const ps = String(p);
      if (ps === '/etc/nginx/sites-available') return true;
      if (ps.includes('sites-enabled/app.conf')) return true;
      return false;
    });
    mockReaddirSync.mockReturnValue(['app.conf'] as any);
    mockReadFileSync.mockReturnValue('server { listen 80; }');

    const sites = listSites();
    expect(sites[0].enabled).toBe(true);
  });

  it('detects SSL in config', () => {
    mockExistsSync.mockImplementation((p) => String(p) === '/etc/nginx/sites-available');
    mockReaddirSync.mockReturnValue(['app.conf'] as any);
    mockReadFileSync.mockReturnValue('server { ssl_certificate /etc/ssl/certs/app.pem; listen 443; }');

    const sites = listSites();
    expect(sites[0].ssl).toBe(true);
  });

  it('ssl is false when no ssl directives present', () => {
    mockExistsSync.mockImplementation((p) => String(p) === '/etc/nginx/sites-available');
    mockReaddirSync.mockReturnValue(['app.conf'] as any);
    mockReadFileSync.mockReturnValue('server { listen 80; proxy_pass http://127.0.0.1:3000; }');

    const sites = listSites();
    expect(sites[0].ssl).toBe(false);
  });
});

describe('installConfig', () => {
  it('calls assertDomain with the provided domain', () => {
    mockExistsSync.mockReturnValue(true);
    installConfig('example.com', 'server {}');
    expect(mockAssertDomain).toHaveBeenCalledWith('example.com');
  });

  it('writes config to sites-available', () => {
    mockExistsSync.mockReturnValue(true);
    installConfig('example.com', 'server {}');
    expect(mockWriteFileSync).toHaveBeenCalledWith(
      '/etc/nginx/sites-available/example.com.conf',
      'server {}',
    );
  });

  it('creates symlink when not already enabled', () => {
    mockExistsSync.mockImplementation((p) => {
      // sites-enabled link does not exist
      if (String(p).includes('sites-enabled')) return false;
      return true;
    });
    mockExecSafe.mockReturnValue({ stdout: '', stderr: '', exitCode: 0, ok: true });
    installConfig('example.com', 'server {}');
    expect(mockExecSafe).toHaveBeenCalledWith(
      'ln',
      expect.arrayContaining(['-sf']),
    );
  });

  it('does not create symlink when already enabled', () => {
    mockExistsSync.mockReturnValue(true);
    installConfig('example.com', 'server {}');
    expect(mockExecSafe).not.toHaveBeenCalled();
  });

  it('rejects injection in domain via assertDomain', () => {
    mockAssertDomain.mockImplementation((d) => {
      if (d.includes(';')) throw new Error('Invalid domain');
    });
    expect(() => installConfig('evil.com; rm -rf /', 'server {}')).toThrow();
  });
});

describe('removeConfig', () => {
  it('calls assertDomain', () => {
    mockExistsSync.mockReturnValue(false);
    removeConfig('example.com');
    expect(mockAssertDomain).toHaveBeenCalledWith('example.com');
  });

  it('removes both enabled symlink and available config', () => {
    mockExistsSync.mockReturnValue(true);
    const result = removeConfig('example.com');
    expect(mockUnlinkSync).toHaveBeenCalledWith('/etc/nginx/sites-enabled/example.com.conf');
    expect(mockUnlinkSync).toHaveBeenCalledWith('/etc/nginx/sites-available/example.com.conf');
    expect(result).toBe(true);
  });

  it('returns false when config file does not exist', () => {
    mockExistsSync.mockReturnValue(false);
    const result = removeConfig('example.com');
    expect(result).toBe(false);
  });

  it('only removes enabled link if it exists', () => {
    mockExistsSync.mockImplementation((p) => {
      if (String(p).includes('sites-enabled')) return false;
      return true;
    });
    removeConfig('example.com');
    expect(mockUnlinkSync).toHaveBeenCalledTimes(1);
    expect(mockUnlinkSync).toHaveBeenCalledWith('/etc/nginx/sites-available/example.com.conf');
  });
});

describe('testConfig', () => {
  it('returns ok=true when nginx -t succeeds', () => {
    mockExecSafe.mockReturnValue({ stdout: '', stderr: 'nginx: configuration file /etc/nginx/nginx.conf test is successful', exitCode: 0, ok: true });
    const result = testConfig();
    expect(result.ok).toBe(true);
  });

  it('returns ok=true when stderr contains "successful" even if exit code is non-zero', () => {
    mockExecSafe.mockReturnValue({ stdout: '', stderr: 'test is successful', exitCode: 1, ok: false });
    const result = testConfig();
    expect(result.ok).toBe(true);
  });

  it('returns ok=false on genuine nginx config error', () => {
    mockExecSafe.mockReturnValue({ stdout: '', stderr: 'nginx: [emerg] unknown directive', exitCode: 1, ok: false });
    const result = testConfig();
    expect(result.ok).toBe(false);
  });

  it('returns output in result', () => {
    mockExecSafe.mockReturnValue({ stdout: '', stderr: 'test output', exitCode: 0, ok: true });
    const result = testConfig();
    expect(result.output).toBe('test output');
  });
});

describe('reload', () => {
  it('returns true when systemctl reload nginx succeeds', () => {
    mockExecSafe.mockReturnValue({ stdout: '', stderr: '', exitCode: 0, ok: true });
    expect(reload()).toBe(true);
  });

  it('returns false when reload fails', () => {
    mockExecSafe.mockReturnValue({ stdout: '', stderr: 'error', exitCode: 1, ok: false });
    expect(reload()).toBe(false);
  });
});

describe('readConfig', () => {
  it('calls assertDomain', () => {
    mockExistsSync.mockReturnValue(false);
    readConfig('example.com');
    expect(mockAssertDomain).toHaveBeenCalledWith('example.com');
  });

  it('returns null when config file does not exist', () => {
    mockExistsSync.mockReturnValue(false);
    expect(readConfig('example.com')).toBeNull();
  });

  it('returns file contents when config exists', () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue('server { listen 80; }');
    expect(readConfig('example.com')).toBe('server { listen 80; }');
  });
});

describe('extractPortFromConfig', () => {
  it('extracts port from proxy_pass with localhost', () => {
    const config = 'proxy_pass http://127.0.0.1:3000;';
    expect(extractPortFromConfig(config)).toBe(3000);
  });

  it('extracts port from proxy_pass with localhost hostname', () => {
    const config = 'proxy_pass http://localhost:8080;';
    expect(extractPortFromConfig(config)).toBe(8080);
  });

  it('returns null when no proxy_pass is found', () => {
    const config = 'server { listen 80; }';
    expect(extractPortFromConfig(config)).toBeNull();
  });

  it('extracts https proxy_pass port', () => {
    const config = 'proxy_pass https://127.0.0.1:4000;';
    expect(extractPortFromConfig(config)).toBe(4000);
  });
});

describe('extractDomainsFromConfig', () => {
  it('extracts single domain from server_name', () => {
    const config = 'server_name example.com;';
    expect(extractDomainsFromConfig(config)).toEqual(['example.com']);
  });

  it('extracts multiple domains', () => {
    const config = 'server_name example.com www.example.com;';
    const domains = extractDomainsFromConfig(config);
    expect(domains).toContain('example.com');
    expect(domains).toContain('www.example.com');
  });

  it('filters out wildcard underscore placeholder', () => {
    const config = 'server_name _ example.com;';
    const domains = extractDomainsFromConfig(config);
    expect(domains).not.toContain('_');
    expect(domains).toContain('example.com');
  });

  it('returns empty array when no server_name directive', () => {
    const config = 'server { listen 80; }';
    expect(extractDomainsFromConfig(config)).toEqual([]);
  });
});

describe('security: domain validation in nginx ops', () => {
  it('installConfig rejects domain with null byte via assertDomain', () => {
    mockAssertDomain.mockImplementation((d) => {
      if (d.includes('\x00')) throw new Error('Invalid domain');
    });
    expect(() => installConfig('evil\x00.com', 'server {}')).toThrow();
  });

  it('removeConfig rejects domain with path traversal via assertDomain', () => {
    mockAssertDomain.mockImplementation((d) => {
      if (d.includes('..')) throw new Error('Invalid domain');
    });
    expect(() => removeConfig('../../etc/nginx')).toThrow();
  });
});
