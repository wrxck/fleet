import { describe, it, expect, vi, beforeEach } from 'vitest';

import { onboardCommand } from './onboard';
import { checkApp } from '../core/onboarding';
import type { OnboardingReport } from '../core/onboarding';

vi.mock('../core/onboarding.js', () => ({
  checkApp: vi.fn(),
}));

vi.mock('../ui/output.js', () => ({
  c: new Proxy({}, { get: () => '' }),
  heading: vi.fn(),
  error: vi.fn(),
}));

const mockCheckApp = vi.mocked(checkApp);

function makeReport(overrides: Partial<OnboardingReport> = {}): OnboardingReport {
  return {
    app: 'staging',
    ok: true,
    checks: [
      { id: 'registry', title: 'Registry entry', status: 'ok', detail: 'registered' },
    ],
    ...overrides,
  };
}

let writes: string[];

beforeEach(() => {
  vi.clearAllMocks();
  writes = [];
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
    writes.push(String(chunk));
    return true;
  });
  mockCheckApp.mockResolvedValue(makeReport());
});

describe('onboardCommand — arguments', () => {
  it('exits with usage when no app is given', async () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    await expect(onboardCommand([])).rejects.toThrow('exit');
    expect(exitSpy).toHaveBeenCalledWith(1);
    exitSpy.mockRestore();
  });
});

describe('onboardCommand — exit codes', () => {
  it('exits zero (no exit call) when every blocking check passes', async () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    await onboardCommand(['staging']);
    expect(exitSpy).not.toHaveBeenCalled();
    exitSpy.mockRestore();
  });

  it('exits non-zero when a blocking check is missing — script-friendly', async () => {
    mockCheckApp.mockResolvedValue(makeReport({
      ok: false,
      checks: [{
        id: 'unit', title: 'Systemd unit', status: 'missing', blocking: true,
        detail: 'staging.service does not exist',
        fix: { runner: 'mcp', command: 'fleet_service_install { app: "staging" }' },
      }],
    }));
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    await expect(onboardCommand(['staging'])).rejects.toThrow('exit');
    expect(exitSpy).toHaveBeenCalledWith(1);
    exitSpy.mockRestore();
  });
});

describe('onboardCommand — output', () => {
  it('prints each check with its fix command and runner label', async () => {
    mockCheckApp.mockResolvedValue(makeReport({
      ok: false,
      checks: [
        {
          id: 'vault-key:NPM_TOKEN', title: 'Vault key NPM_TOKEN', status: 'missing', blocking: true,
          detail: 'NPM_TOKEN is required by the compose file but not in the vault',
          fix: { runner: 'operator-root', command: `printf '%s' "$VALUE" | sudo fleet secrets set staging NPM_TOKEN --from-stdin` },
        },
      ],
    }));
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    await expect(onboardCommand(['staging'])).rejects.toThrow('exit');
    const out = writes.join('');
    expect(out).toMatch(/Vault key NPM_TOKEN/);
    expect(out).toMatch(/operator, root shell/);
    expect(out).toMatch(/--from-stdin/);
    exitSpy.mockRestore();
  });

  it('prints the raw report as json with --json', async () => {
    await onboardCommand(['staging', '--json']);
    const parsed = JSON.parse(writes.join(''));
    expect(parsed.app).toBe('staging');
    expect(parsed.ok).toBeTruthy();
  });
});
