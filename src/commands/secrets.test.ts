import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('node:fs', async () => {
  const actual = await vi.importActual<typeof import('node:fs')>('node:fs');
  return { ...actual, writeFileSync: vi.fn(), existsSync: vi.fn() };
});

vi.mock('../core/registry.js', () => ({
  load: vi.fn(),
  findApp: vi.fn(),
}));

vi.mock('../core/secrets.js', () => ({
  initVault: vi.fn(),
  getPublicKey: vi.fn(),
  loadManifest: vi.fn(),
  listSecrets: vi.fn(),
  restoreVaultFile: vi.fn(),
  isInitialized: vi.fn(),
}));

vi.mock('../core/secrets-ops.js', () => ({
  setSecret: vi.fn(),
  getSecret: vi.fn(),
  importEnvFile: vi.fn(),
  importDbSecrets: vi.fn(),
  exportApp: vi.fn(),
  unsealAll: vi.fn(),
  sealFromRuntime: vi.fn(),
  rotateKey: vi.fn(),
  getStatus: vi.fn(),
  detectDrift: vi.fn(),
}));

vi.mock('../core/secrets-validate.js', () => ({
  validateApp: vi.fn(),
  validateAll: vi.fn(),
}));

vi.mock('../core/exec.js', () => ({
  execSafe: vi.fn(),
}));

vi.mock('../templates/unseal.js', () => ({
  generateUnsealService: vi.fn().mockReturnValue('[Unit]'),
}));

vi.mock('../ui/confirm.js', () => ({
  confirm: vi.fn(),
}));

vi.mock('../ui/output.js', () => ({
  c: { green: '', red: '', yellow: '', dim: '', bold: '', reset: '' },
  heading: vi.fn(),
  table: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
}));

import { secretsCommand } from './secrets.js';
import { load, findApp } from '../core/registry.js';
import {
  initVault, loadManifest, listSecrets, restoreVaultFile,
} from '../core/secrets.js';
import {
  setSecret, getSecret, exportApp, unsealAll, sealFromRuntime,
  getStatus, detectDrift,
} from '../core/secrets-ops.js';
import { validateApp, validateAll } from '../core/secrets-validate.js';
import { error } from '../ui/output.js';

const mockLoad = vi.mocked(load);
const mockFindApp = vi.mocked(findApp);
const mockSetSecret = vi.mocked(setSecret);
const mockGetSecret = vi.mocked(getSecret);
const mockExportApp = vi.mocked(exportApp);
const mockUnsealAll = vi.mocked(unsealAll);
const mockSealFromRuntime = vi.mocked(sealFromRuntime);
const mockGetStatus = vi.mocked(getStatus);
const mockDetectDrift = vi.mocked(detectDrift);
const mockValidateApp = vi.mocked(validateApp);
const mockValidateAll = vi.mocked(validateAll);
const mockLoadManifest = vi.mocked(loadManifest);
const mockListSecrets = vi.mocked(listSecrets);
const mockRestoreVaultFile = vi.mocked(restoreVaultFile);
const mockError = vi.mocked(error);
const mockInitVault = vi.mocked(initVault);

function makeRegistry() {
  return {
    version: 1,
    apps: [],
    infrastructure: {
      databases: { serviceName: 'docker-databases', composePath: '/db' },
      nginx: { configPath: '/etc/nginx' },
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockLoad.mockReturnValue(makeRegistry());
  mockSealFromRuntime.mockReturnValue([]);
  mockGetStatus.mockReturnValue({
    initialized: true,
    sealed: false,
    keyPath: '/etc/fleet/age.key',
    vaultDir: '/etc/fleet/vault',
    runtimeDir: '/run/fleet-secrets',
    appCount: 0,
    totalKeys: 0,
  });
});

describe('secretsCommand — subcommand routing', () => {
  it('calls getStatus for "status"', async () => {
    await secretsCommand(['status', '--json']);
    expect(mockGetStatus).toHaveBeenCalled();
  });

  it('calls detectDrift for "drift"', async () => {
    mockDetectDrift.mockReturnValue([]);
    await secretsCommand(['drift', '--json']);
    expect(mockDetectDrift).toHaveBeenCalled();
  });

  it('calls sealFromRuntime for "seal"', async () => {
    await secretsCommand(['seal']);
    expect(mockSealFromRuntime).toHaveBeenCalled();
  });

  it('calls unsealAll for "unseal"', async () => {
    mockLoadManifest.mockReturnValue({ version: 1, apps: {} });
    await secretsCommand(['unseal']);
    expect(mockUnsealAll).toHaveBeenCalled();
  });

  it('exits on unknown subcommand', async () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    await expect(secretsCommand(['bogus'])).rejects.toThrow('exit');
    exitSpy.mockRestore();
  });
});

describe('secretsCommand — secrets set', () => {
  // Post-incident hardening: argv-as-value is REJECTED at the CLI layer
  // (process arguments are world-readable via /proc/<pid>/cmdline + land
  // in shell history). The new contract: interactive prompt by default,
  // explicit `--from-stdin` for piped values.
  it('refuses argv-as-value before reaching setSecret', async () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    await expect(
      secretsCommand(['set', 'myapp', 'DATABASE_URL', 'postgres://localhost/db']),
    ).rejects.toThrow('exit');
    expect(mockSetSecret).not.toHaveBeenCalled();
    exitSpy.mockRestore();
  });

  it('exits when app is missing', async () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    await expect(secretsCommand(['set'])).rejects.toThrow('exit');
    exitSpy.mockRestore();
  });

  it('exits when key is missing', async () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    await expect(secretsCommand(['set', 'myapp'])).rejects.toThrow('exit');
    exitSpy.mockRestore();
  });
});

describe('secretsCommand — secrets get', () => {
  it('calls getSecret and writes value', async () => {
    mockGetSecret.mockReturnValue('secret-value');
    const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    await secretsCommand(['get', 'myapp', 'MY_KEY']);
    expect(mockGetSecret).toHaveBeenCalledWith('myapp', 'MY_KEY');
    expect(writeSpy).toHaveBeenCalledWith('secret-value\n');
    writeSpy.mockRestore();
  });

  it('exits when key is not found', async () => {
    mockGetSecret.mockReturnValue(null);
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    await expect(secretsCommand(['get', 'myapp', 'MISSING'])).rejects.toThrow('exit');
    exitSpy.mockRestore();
  });

  it('exits when app is missing', async () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    await expect(secretsCommand(['get'])).rejects.toThrow('exit');
    exitSpy.mockRestore();
  });
});

describe('secretsCommand — secrets export', () => {
  it('calls exportApp and writes output', async () => {
    mockExportApp.mockReturnValue('KEY=value\n');
    const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    await secretsCommand(['export', 'myapp']);
    expect(mockExportApp).toHaveBeenCalledWith('myapp');
    writeSpy.mockRestore();
  });

  it('exits when app is missing', async () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    await expect(secretsCommand(['export'])).rejects.toThrow('exit');
    exitSpy.mockRestore();
  });
});

describe('secretsCommand — secrets seal', () => {
  it('passes app name to sealFromRuntime', async () => {
    mockSealFromRuntime.mockReturnValue(['myapp']);
    await secretsCommand(['seal', 'myapp']);
    expect(mockSealFromRuntime).toHaveBeenCalledWith('myapp');
  });

  it('calls sealFromRuntime without app to seal all', async () => {
    mockSealFromRuntime.mockReturnValue(['app-a', 'app-b']);
    await secretsCommand(['seal']);
    expect(mockSealFromRuntime).toHaveBeenCalledWith(undefined);
  });
});

describe('secretsCommand — secrets validate', () => {
  it('calls validateAll when no app specified', async () => {
    mockValidateAll.mockReturnValue([]);
    await secretsCommand(['validate']);
    expect(mockValidateAll).toHaveBeenCalled();
  });

  it('calls validateApp when app specified', async () => {
    mockValidateApp.mockReturnValue({ app: 'myapp', ok: true, missing: [], extra: [] });
    await secretsCommand(['validate', 'myapp']);
    expect(mockValidateApp).toHaveBeenCalledWith('myapp');
  });

  it('outputs json when --json flag given', async () => {
    mockValidateAll.mockReturnValue([{ app: 'myapp', ok: true, missing: [], extra: [] }]);
    const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    await secretsCommand(['validate', '--json']);
    expect(writeSpy).toHaveBeenCalledWith(expect.stringContaining('"myapp"'));
    writeSpy.mockRestore();
  });
});

describe('secretsCommand — secrets list', () => {
  it('calls listSecrets when app specified', async () => {
    mockListSecrets.mockReturnValue([]);
    await secretsCommand(['list', 'myapp']);
    expect(mockListSecrets).toHaveBeenCalledWith('myapp');
  });

  it('calls loadManifest when no app specified', async () => {
    mockLoadManifest.mockReturnValue({ version: 1, apps: {} });
    await secretsCommand(['list']);
    expect(mockLoadManifest).toHaveBeenCalled();
  });
});

describe('secretsCommand — secrets restore', () => {
  it('calls restoreVaultFile with app name', async () => {
    mockRestoreVaultFile.mockReturnValue(true);
    await secretsCommand(['restore', 'myapp']);
    expect(mockRestoreVaultFile).toHaveBeenCalledWith('myapp');
  });

  it('exits when no backup found', async () => {
    mockRestoreVaultFile.mockReturnValue(false);
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    await expect(secretsCommand(['restore', 'myapp'])).rejects.toThrow('exit');
    exitSpy.mockRestore();
  });

  it('exits when app is missing', async () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    await expect(secretsCommand(['restore'])).rejects.toThrow('exit');
    exitSpy.mockRestore();
  });
});

describe('secretsCommand — drift output', () => {
  it('returns json when --json flag used', async () => {
    const driftResult = [{ app: 'myapp', status: 'in-sync', addedKeys: [], removedKeys: [], changedKeys: [] }];
    mockDetectDrift.mockReturnValue(driftResult);
    const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    await secretsCommand(['drift', '--json']);
    expect(writeSpy).toHaveBeenCalledWith(expect.stringContaining('"in-sync"'));
    writeSpy.mockRestore();
  });

  it('passes app name filter to detectDrift', async () => {
    mockDetectDrift.mockReturnValue([]);
    await secretsCommand(['drift', 'myapp', '--json']);
    expect(mockDetectDrift).toHaveBeenCalledWith('myapp');
  });
});

describe('security — path traversal and injection', () => {
  // The previous two tests verified that the CLI passed traversal/injection
  // inputs through to setSecret (relying on downstream validate to reject).
  // The new contract is stronger: any argv-as-value form is rejected at the
  // CLI layer, so the inputs never reach setSecret in the first place.
  it('rejects path-traversal app name + value-as-argv before setSecret', async () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    await expect(secretsCommand(['set', '../etc/passwd', 'KEY', 'val'])).rejects.toThrow('exit');
    expect(mockSetSecret).not.toHaveBeenCalled();
    exitSpy.mockRestore();
  });

  it('rejects shell-metachar value-as-argv before setSecret', async () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    await expect(secretsCommand(['set', 'myapp', 'KEY', 'val; rm -rf /'])).rejects.toThrow('exit');
    expect(mockSetSecret).not.toHaveBeenCalled();
    exitSpy.mockRestore();
  });

  it('seal-runtime routes to sealFromRuntime', async () => {
    mockSealFromRuntime.mockReturnValue([]);
    await secretsCommand(['seal-runtime', 'myapp']);
    expect(mockSealFromRuntime).toHaveBeenCalledWith('myapp');
  });
});
