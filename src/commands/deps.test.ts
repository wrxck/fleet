import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../core/registry.js', () => ({
  load: vi.fn(),
  findApp: vi.fn(),
}));

vi.mock('../core/deps/config.js', () => ({
  loadConfig: vi.fn(),
  saveConfig: vi.fn(),
  defaultConfig: {},
  configPath: vi.fn(),
}));

vi.mock('../core/deps/cache.js', () => ({
  loadCache: vi.fn(),
  saveCache: vi.fn(),
  isCacheStale: vi.fn(),
  cachePath: vi.fn(),
}));

vi.mock('../core/deps/scanner.js', () => ({
  runScan: vi.fn(),
}));

vi.mock('../core/deps/reporters/cli.js', () => ({
  formatSummary: vi.fn(),
  formatAppDetail: vi.fn(),
}));

vi.mock('../core/deps/reporters/motd.js', () => ({
  formatMotd: vi.fn(),
  generateMotdScript: vi.fn(),
}));

vi.mock('../core/deps/reporters/telegram.js', () => ({
  sendTelegramNotification: vi.fn(),
  loadNotifiedFindings: vi.fn(),
  saveNotifiedFindings: vi.fn(),
}));

vi.mock('../core/deps/actors/pr-creator.js', () => ({
  createDepsPr: vi.fn(),
}));

vi.mock('../ui/output.js', () => ({
  heading: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
}));

import { depsCommand } from './deps.js';
import { load, findApp } from '../core/registry.js';
import { loadConfig, saveConfig, configPath } from '../core/deps/config.js';
import { loadCache, saveCache, isCacheStale, cachePath } from '../core/deps/cache.js';
import { runScan } from '../core/deps/scanner.js';
import { formatSummary, formatAppDetail } from '../core/deps/reporters/cli.js';
import { formatMotd } from '../core/deps/reporters/motd.js';
import { createDepsPr } from '../core/deps/actors/pr-creator.js';

const mockLoad = vi.mocked(load);
const mockFindApp = vi.mocked(findApp);
const mockLoadConfig = vi.mocked(loadConfig);
const mockSaveConfig = vi.mocked(saveConfig);
const mockConfigPath = vi.mocked(configPath);
const mockLoadCache = vi.mocked(loadCache);
const mockSaveCache = vi.mocked(saveCache);
const mockIsCacheStale = vi.mocked(isCacheStale);
const mockRunScan = vi.mocked(runScan);
const mockFormatSummary = vi.mocked(formatSummary);
const mockFormatAppDetail = vi.mocked(formatAppDetail);
const mockFormatMotd = vi.mocked(formatMotd);
const mockCreateDepsPr = vi.mocked(createDepsPr);

function makeRegistry() {
  return {
    version: 1,
    apps: [{ name: 'myapp', composePath: '/apps/myapp' }],
    infrastructure: {
      databases: { serviceName: 'docker-databases', composePath: '/db' },
      nginx: { configPath: '/etc/nginx' },
    },
  };
}

function makeConfig() {
  return {
    scanIntervalHours: 24,
    concurrency: 4,
    ignore: [],
    notifications: {
      telegram: { enabled: false, botToken: '', chatId: '', minSeverity: 'high' },
    },
  };
}

function makeCache() {
  return {
    lastScan: '2026-01-01T00:00:00.000Z',
    scanDurationMs: 1000,
    findings: [],
    errors: [],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockLoad.mockReturnValue(makeRegistry() as ReturnType<typeof load>);
  mockFindApp.mockReturnValue(makeRegistry().apps[0] as ReturnType<typeof findApp>);
  mockLoadConfig.mockReturnValue(makeConfig() as ReturnType<typeof loadConfig>);
  mockLoadCache.mockReturnValue(makeCache() as ReturnType<typeof loadCache>);
  mockIsCacheStale.mockReturnValue(false);
  mockFormatSummary.mockReturnValue(['summary line']);
  mockFormatAppDetail.mockReturnValue(['detail line']);
  mockFormatMotd.mockReturnValue('motd text');
  mockConfigPath.mockReturnValue('/etc/fleet/deps.json');
  (cachePath as ReturnType<typeof vi.fn>).mockReturnValue('/etc/fleet/deps-cache.json');
});

describe('depsCommand — show (default)', () => {
  it('warns when no cache found', async () => {
    mockLoadCache.mockReturnValue(null);
    await depsCommand([]);
    // no throw, just warns
  });

  it('outputs json when --json flag given', async () => {
    const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    await depsCommand(['--json']);
    expect(writeSpy).toHaveBeenCalledWith(expect.stringContaining('"lastScan"'));
    writeSpy.mockRestore();
  });

  it('outputs motd when --motd flag given', async () => {
    const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    await depsCommand(['--motd']);
    expect(mockFormatMotd).toHaveBeenCalled();
    writeSpy.mockRestore();
  });

  it('throws AppNotFoundError when app not found', async () => {
    mockFindApp.mockReturnValue(undefined);
    await expect(depsCommand(['nonexistent'])).rejects.toThrow('App not found');
  });

  it('shows app detail when app name given', async () => {
    await depsCommand(['myapp']);
    expect(mockFormatAppDetail).toHaveBeenCalled();
  });

  it('outputs json for specific app when --json given', async () => {
    const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    await depsCommand(['myapp', '--json']);
    expect(writeSpy).toHaveBeenCalledWith(expect.stringContaining('['));
    writeSpy.mockRestore();
  });
});

describe('depsCommand — scan', () => {
  it('runs scan and saves cache', async () => {
    mockRunScan.mockResolvedValue(makeCache() as Awaited<ReturnType<typeof runScan>>);
    await depsCommand(['scan']);
    expect(mockRunScan).toHaveBeenCalled();
    expect(mockSaveCache).toHaveBeenCalled();
  });

  it('runs quietly with --quiet flag', async () => {
    mockRunScan.mockResolvedValue(makeCache() as Awaited<ReturnType<typeof runScan>>);
    await depsCommand(['scan', '--quiet']);
    expect(mockRunScan).toHaveBeenCalled();
  });
});

describe('depsCommand — fix', () => {
  it('exits when no app given', async () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    await expect(depsCommand(['fix'])).rejects.toThrow('exit');
    exitSpy.mockRestore();
  });

  it('exits when no cache found', async () => {
    mockLoadCache.mockReturnValue(null);
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    await expect(depsCommand(['fix', 'myapp'])).rejects.toThrow('exit');
    exitSpy.mockRestore();
  });

  it('throws AppNotFoundError when app not found', async () => {
    mockFindApp.mockReturnValue(undefined);
    await expect(depsCommand(['fix', 'nonexistent'])).rejects.toThrow('App not found');
  });

  it('creates PR when fixable findings exist', async () => {
    mockLoadCache.mockReturnValue({
      ...makeCache(),
      findings: [{ appName: 'myapp', fixable: true, severity: 'high', package: 'pkg', current: '1.0', latest: '2.0' }],
    } as ReturnType<typeof loadCache>);
    mockCreateDepsPr.mockReturnValue({ branch: 'feat/deps', bumps: [], prUrl: 'https://github.com/pr/1' });
    await depsCommand(['fix', 'myapp']);
    expect(mockCreateDepsPr).toHaveBeenCalled();
  });
});

describe('depsCommand — config', () => {
  it('outputs current config when no args', async () => {
    const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    await depsCommand(['config']);
    expect(writeSpy).toHaveBeenCalledWith(expect.stringContaining('"scanIntervalHours"'));
    writeSpy.mockRestore();
  });

  it('sets allowed config key', async () => {
    await depsCommand(['config', 'set', 'scanIntervalHours', '12']);
    expect(mockSaveConfig).toHaveBeenCalled();
  });

  it('exits when setting disallowed key', async () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    await expect(depsCommand(['config', 'set', '__proto__', 'evil'])).rejects.toThrow('exit');
    exitSpy.mockRestore();
  });
});

describe('depsCommand — ignore', () => {
  it('exits when package or reason missing', async () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    await expect(depsCommand(['ignore', 'lodash'])).rejects.toThrow('exit');
    exitSpy.mockRestore();
  });

  it('adds ignore rule and saves config', async () => {
    await depsCommand(['ignore', 'lodash', '--reason', 'false positive']);
    expect(mockSaveConfig).toHaveBeenCalled();
  });
});

describe('depsCommand — unignore', () => {
  it('exits when package missing', async () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    await expect(depsCommand(['unignore'])).rejects.toThrow('exit');
    exitSpy.mockRestore();
  });

  it('removes ignore rule and saves config', async () => {
    const cfg = makeConfig();
    cfg.ignore.push({ package: 'lodash', reason: 'test' });
    mockLoadConfig.mockReturnValue(cfg as ReturnType<typeof loadConfig>);
    await depsCommand(['unignore', 'lodash']);
    expect(mockSaveConfig).toHaveBeenCalled();
  });
});
