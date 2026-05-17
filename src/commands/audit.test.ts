import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../core/audit/greenlight.js', () => ({
  findGreenlight: vi.fn(),
  greenlightVersion: vi.fn(),
  runPreflight: vi.fn(),
  runGuidelines: vi.fn(),
  GREENLIGHT_INSTALL_HINT: 'greenlight binary not found\n  go install ...\n  brew ...',
}));
vi.mock('../core/audit/target.js', () => ({ resolveAuditTarget: vi.fn() }));
vi.mock('../core/audit/cache.js', () => ({ saveAuditRecord: vi.fn() }));
vi.mock('../core/audit/config.js', () => ({
  loadAuditConfig: vi.fn(),
  saveAuditConfig: vi.fn(),
}));
vi.mock('../core/audit/suppress.js', () => ({ applySuppressions: vi.fn() }));
vi.mock('../core/audit/reporters/cli.js', () => ({
  formatReport: vi.fn(() => ['report line']),
}));
vi.mock('../ui/output.js', () => ({
  heading: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
}));

import { auditCommand } from './audit';
import {
  findGreenlight, greenlightVersion, runPreflight, runGuidelines,
} from '../core/audit/greenlight';
import { resolveAuditTarget } from '../core/audit/target';
import { saveAuditRecord } from '../core/audit/cache';
import { loadAuditConfig, saveAuditConfig } from '../core/audit/config';
import { applySuppressions } from '../core/audit/suppress';

const mockFind = vi.mocked(findGreenlight);
const mockVersion = vi.mocked(greenlightVersion);
const mockPreflight = vi.mocked(runPreflight);
const mockGuidelines = vi.mocked(runGuidelines);
const mockResolve = vi.mocked(resolveAuditTarget);
const mockSave = vi.mocked(saveAuditRecord);
const mockLoadConfig = vi.mocked(loadAuditConfig);
const mockSaveConfig = vi.mocked(saveAuditConfig);
const mockSuppress = vi.mocked(applySuppressions);

function makeReport() {
  return {
    project_path: '/p/mobile',
    has_privacy_info: true,
    findings: [],
    summary: { total: 0, critical: 0, warns: 0, infos: 0, passed: true },
    elapsed: '8ms',
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockFind.mockReturnValue('greenlight');
  mockResolve.mockReturnValue({ target: 'shiftfaced', projectPath: '/p/mobile' });
  mockPreflight.mockReturnValue(makeReport() as ReturnType<typeof runPreflight>);
  mockLoadConfig.mockReturnValue({ version: 1, ignore: [] });
  mockSuppress.mockImplementation((report) => ({ report, suppressed: 0 }));
});

describe('auditCommand — run', () => {
  it('runs preflight and caches the result', async () => {
    const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    await auditCommand(['shiftfaced']);
    expect(mockPreflight).toHaveBeenCalledWith('/p/mobile', { ipaPath: undefined });
    expect(mockSave).toHaveBeenCalled();
    writeSpy.mockRestore();
  });

  it('emits the record as json with --json', async () => {
    const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    await auditCommand(['shiftfaced', '--json']);
    expect(writeSpy).toHaveBeenCalledWith(expect.stringContaining('"project_path"'));
    writeSpy.mockRestore();
  });

  it('exits when greenlight is not installed', async () => {
    mockFind.mockReturnValue(null);
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('exit');
    });
    await expect(auditCommand(['shiftfaced'])).rejects.toThrow('exit');
    exitSpy.mockRestore();
  });
});

describe('auditCommand — guidelines', () => {
  it('passes the subcommand through to runGuidelines', async () => {
    mockGuidelines.mockReturnValue('Guideline 2.1');
    const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    await auditCommand(['guidelines', 'show', '2.1']);
    expect(mockGuidelines).toHaveBeenCalledWith(['show', '2.1']);
    writeSpy.mockRestore();
  });
});

describe('auditCommand — doctor', () => {
  it('reads the version when the binary is found', async () => {
    mockVersion.mockReturnValue('greenlight v1.0.0');
    await auditCommand(['doctor']);
    expect(mockVersion).toHaveBeenCalledWith('greenlight');
  });

  it('exits when the binary is missing', async () => {
    mockFind.mockReturnValue(null);
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('exit');
    });
    await expect(auditCommand(['doctor'])).rejects.toThrow('exit');
    exitSpy.mockRestore();
  });
});

describe('auditCommand — ignore', () => {
  it('adds an ignore rule and saves the config', async () => {
    await auditCommand([
      'ignore', 'Placeholder content in user-facing strings',
      '--reason', 'react native placeholder prop', '--target', 'shiftfaced',
    ]);
    expect(mockSaveConfig).toHaveBeenCalled();
    const saved = mockSaveConfig.mock.calls[0][0];
    expect(saved.ignore[0]).toMatchObject({
      title: 'Placeholder content in user-facing strings',
      target: 'shiftfaced',
      reason: 'react native placeholder prop',
    });
  });

  it('exits when reason is missing', async () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('exit');
    });
    await expect(auditCommand(['ignore', 'Some finding'])).rejects.toThrow('exit');
    exitSpy.mockRestore();
  });
});

describe('auditCommand — unignore', () => {
  it('removes a matching ignore rule and saves the config', async () => {
    mockLoadConfig.mockReturnValue({
      version: 1,
      ignore: [{ title: 'Some finding', reason: 'x', addedAt: '2026-05-17T00:00:00.000Z' }],
    });
    await auditCommand(['unignore', 'Some finding']);
    expect(mockSaveConfig).toHaveBeenCalled();
    expect(mockSaveConfig.mock.calls[0][0].ignore).toHaveLength(0);
  });
});

describe('auditCommand — run with suppressions', () => {
  it('reports how many findings the ignore rules suppressed', async () => {
    const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    mockSuppress.mockImplementation((report) => ({ report, suppressed: 2 }));
    await auditCommand(['shiftfaced']);
    expect(mockSuppress).toHaveBeenCalled();
    writeSpy.mockRestore();
  });
});
