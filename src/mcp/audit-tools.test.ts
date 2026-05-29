import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../core/audit/greenlight.js', () => ({
  findGreenlight: vi.fn(),
  runPreflight: vi.fn(),
  runGuidelines: vi.fn(),
}));
vi.mock('../core/audit/target.js', () => ({ resolveAuditTarget: vi.fn() }));
vi.mock('../core/audit/cache.js', () => ({
  loadAuditCache: vi.fn(),
  saveAuditRecord: vi.fn(),
}));
vi.mock('../core/audit/config.js', () => ({
  loadAuditConfig: vi.fn(() => ({ version: 1, ignore: [] })),
  saveAuditConfig: vi.fn(),
}));
vi.mock('../core/audit/suppress.js', () => ({
  applySuppressions: vi.fn((report) => ({ report, suppressed: 0 })),
}));

import { findGreenlight, runPreflight, runGuidelines } from '../core/audit/greenlight';
import { resolveAuditTarget } from '../core/audit/target';
import { loadAuditCache } from '../core/audit/cache';
import { saveAuditConfig } from '../core/audit/config';
import { registerAuditTools } from './audit-tools';

const mockFind = vi.mocked(findGreenlight);
const mockPreflight = vi.mocked(runPreflight);
const mockGuidelines = vi.mocked(runGuidelines);
const mockResolve = vi.mocked(resolveAuditTarget);
const mockLoadCache = vi.mocked(loadAuditCache);
const mockSaveConfig = vi.mocked(saveAuditConfig);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function register(): any[] {
  const server = { tool: vi.fn() };
  registerAuditTools(server as never);
  return server.tool.mock.calls;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function handlerFor(calls: any[], name: string) {
  const call = calls.find((c) => c[0] === name);
  return call[call.length - 1];
}

beforeEach(() => vi.clearAllMocks());

describe('registerAuditTools', () => {
  it('registers the audit tools', () => {
    const names = register().map((c) => c[0]);
    expect(names).toEqual(
      expect.arrayContaining([
        'fleet_audit_run',
        'fleet_audit_status',
        'fleet_audit_guidelines',
        'fleet_audit_ignore',
      ]),
    );
  });

  it('fleet_audit_run reports when greenlight is missing', async () => {
    mockFind.mockReturnValue(null);
    const run = handlerFor(register(), 'fleet_audit_run');
    const res = await run({ target: 'shiftfaced' });
    expect(res.content[0].text).toContain('greenlight binary not found');
  });

  it('fleet_audit_run scans and returns the record', async () => {
    mockFind.mockReturnValue('greenlight');
    mockResolve.mockReturnValue({ target: 'shiftfaced', projectPath: '/p/mobile' });
    mockPreflight.mockReturnValue({
      project_path: '/p/mobile',
      has_privacy_info: true,
      findings: [],
      summary: { total: 0, critical: 0, warns: 0, infos: 0, passed: true },
      elapsed: '7ms',
    } as ReturnType<typeof runPreflight>);
    const run = handlerFor(register(), 'fleet_audit_run');
    const res = await run({ target: 'shiftfaced' });
    expect(res.content[0].text).toContain('"passed": true');
  });

  it('fleet_audit_status reports when nothing is cached', async () => {
    mockLoadCache.mockReturnValue({ version: 1, audits: {} });
    const status = handlerFor(register(), 'fleet_audit_status');
    const res = await status({});
    expect(res.content[0].text).toContain('No audits cached');
  });

  it('fleet_audit_ignore persists an ignore rule', async () => {
    const ignore = handlerFor(register(), 'fleet_audit_ignore');
    const res = await ignore({ title: 'Placeholder content', reason: 'rn prop' });
    expect(mockSaveConfig).toHaveBeenCalled();
    expect(res.content[0].text).toContain('Ignoring');
  });

  it('fleet_audit_guidelines requires a query for show', async () => {
    mockFind.mockReturnValue('greenlight');
    const guidelines = handlerFor(register(), 'fleet_audit_guidelines');
    const res = await guidelines({ action: 'show' });
    expect(res.content[0].text).toContain('requires a query');
  });

  it('fleet_audit_guidelines passes list through', async () => {
    mockFind.mockReturnValue('greenlight');
    mockGuidelines.mockReturnValue('section list');
    const guidelines = handlerFor(register(), 'fleet_audit_guidelines');
    await guidelines({ action: 'list' });
    expect(mockGuidelines).toHaveBeenCalledWith(['list']);
  });
});
