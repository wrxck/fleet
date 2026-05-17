import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../core/testflight/resolve.js', () => ({
  resolveTestflightTarget: vi.fn(() => ({ app: 'shiftfaced', projectPath: '/p/mobile' })),
  appSecretsEnv: vi.fn(),
}));
vi.mock('../core/testflight/credentials.js', () => ({
  resolveAscCredentials: vi.fn(() => ({ keyId: 'k', issuerId: 'i', privateKey: 'p' })),
  hasAscCredentials: vi.fn(),
}));
vi.mock('../core/testflight/asc.js', () => ({ listBuilds: vi.fn(), verifyApp: vi.fn() }));
vi.mock('../core/testflight/workflow.js', () => ({ ghVersion: vi.fn(), resolveRepo: vi.fn() }));

import { appSecretsEnv } from '../core/testflight/resolve';
import { hasAscCredentials } from '../core/testflight/credentials';
import { listBuilds } from '../core/testflight/asc';
import { ghVersion, resolveRepo } from '../core/testflight/workflow';
import { registerTestflightTools } from './testflight-tools';

const mockEnv = vi.mocked(appSecretsEnv);
const mockHasCreds = vi.mocked(hasAscCredentials);
const mockListBuilds = vi.mocked(listBuilds);
const mockGhVersion = vi.mocked(ghVersion);
const mockResolveRepo = vi.mocked(resolveRepo);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function register(): any[] {
  const server = { tool: vi.fn() };
  registerTestflightTools(server as never);
  return server.tool.mock.calls;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function handlerFor(calls: any[], name: string) {
  const call = calls.find((c) => c[0] === name);
  return call[call.length - 1];
}

beforeEach(() => vi.clearAllMocks());

describe('registerTestflightTools', () => {
  it('registers the testflight tools', () => {
    const names = register().map((c) => c[0]);
    expect(names).toEqual(
      expect.arrayContaining(['fleet_testflight_builds', 'fleet_testflight_doctor']),
    );
  });

  it('fleet_testflight_builds reports when credentials are missing', async () => {
    mockHasCreds.mockReturnValue(false);
    mockEnv.mockReturnValue({});
    const builds = handlerFor(register(), 'fleet_testflight_builds');
    const res = await builds({ app: 'shiftfaced' });
    expect(res.content[0].text).toContain('credentials missing');
  });

  it('fleet_testflight_builds returns the builds json', async () => {
    mockHasCreds.mockReturnValue(true);
    mockEnv.mockReturnValue({ ASC_APP_ID: 'asc1' });
    mockListBuilds.mockResolvedValue([{
      id: 'b1', version: '1', shortVersion: '0.1.0',
      processingState: 'VALID', expired: false, uploadedDate: '2026-05-17',
    }]);
    const builds = handlerFor(register(), 'fleet_testflight_builds');
    const res = await builds({ app: 'shiftfaced' });
    expect(res.content[0].text).toContain('"b1"');
  });

  it('fleet_testflight_doctor reports gh, repo and credential state', async () => {
    mockGhVersion.mockReturnValue('gh version 2.40.0');
    mockResolveRepo.mockReturnValue('wrxck/shiftfaced');
    mockHasCreds.mockReturnValue(false);
    mockEnv.mockReturnValue({});
    const doctor = handlerFor(register(), 'fleet_testflight_doctor');
    const res = await doctor({ app: 'shiftfaced' });
    expect(res.content[0].text).toContain('gh version 2.40.0');
    expect(res.content[0].text).toContain('github repo: wrxck/shiftfaced');
    expect(res.content[0].text).toContain('asc credentials: missing');
  });
});
