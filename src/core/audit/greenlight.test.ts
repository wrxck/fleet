import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../exec.js', () => ({ execSafe: vi.fn() }));
vi.mock('node:fs', () => ({ existsSync: vi.fn() }));

import { execSafe } from '../exec';
import { existsSync } from 'node:fs';
import {
  findGreenlight, runPreflight, runGuidelines, greenlightVersion,
} from './greenlight';

const mockExec = vi.mocked(execSafe);
const mockExists = vi.mocked(existsSync);

function ok(stdout = ''): ReturnType<typeof execSafe> {
  return { stdout, stderr: '', exitCode: 0, ok: true };
}
function fail(stderr = 'boom'): ReturnType<typeof execSafe> {
  return { stdout: '', stderr, exitCode: 1, ok: false };
}

const sampleReport = {
  project_path: '/p',
  has_privacy_info: true,
  findings: [],
  summary: { total: 0, critical: 0, warns: 0, infos: 0, passed: true },
  elapsed: '10ms',
};

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.GREENLIGHT_BIN;
  delete process.env.GOBIN;
});

describe('findGreenlight', () => {
  it('returns the bare name when greenlight is on PATH', () => {
    mockExec.mockReturnValueOnce(ok());
    expect(findGreenlight()).toBe('greenlight');
  });

  it('honours GREENLIGHT_BIN when the file exists', () => {
    process.env.GREENLIGHT_BIN = '/custom/greenlight';
    mockExists.mockReturnValue(true);
    expect(findGreenlight()).toBe('/custom/greenlight');
  });

  it('returns null when GREENLIGHT_BIN points at a missing file', () => {
    process.env.GREENLIGHT_BIN = '/custom/greenlight';
    mockExists.mockReturnValue(false);
    expect(findGreenlight()).toBeNull();
  });

  it('falls back to the go install location', () => {
    mockExec
      .mockReturnValueOnce(fail())
      .mockReturnValueOnce(ok('/root/go'));
    mockExists.mockImplementation((p) => p === '/root/go/bin/greenlight');
    expect(findGreenlight()).toBe('/root/go/bin/greenlight');
  });

  it('returns null when nothing is found', () => {
    mockExec.mockReturnValue(fail());
    mockExists.mockReturnValue(false);
    expect(findGreenlight()).toBeNull();
  });
});

describe('runPreflight', () => {
  it('parses the json report on a successful scan', () => {
    mockExec.mockReturnValue(ok(JSON.stringify(sampleReport)));
    expect(runPreflight('/p', {}, 'greenlight').summary.passed).toBe(true);
  });

  it('passes --ipa through when an ipa path is given', () => {
    mockExec.mockReturnValue(ok(JSON.stringify(sampleReport)));
    runPreflight('/p', { ipaPath: '/b.ipa' }, 'greenlight');
    expect(mockExec.mock.calls[0][1]).toEqual(
      ['preflight', '/p', '--format', 'json', '--ipa', '/b.ipa'],
    );
  });

  it('throws when the scan exits non-zero', () => {
    mockExec.mockReturnValue(fail('bad path'));
    expect(() => runPreflight('/p', {}, 'greenlight')).toThrow(/greenlight preflight failed/);
  });

  it('throws when greenlight emits non-json', () => {
    mockExec.mockReturnValue(ok('not json at all'));
    expect(() => runPreflight('/p', {}, 'greenlight')).toThrow(/not valid json/);
  });
});

describe('runGuidelines', () => {
  it('returns the rendered guidelines text', () => {
    mockExec.mockReturnValue(ok('  Guideline 2.1'));
    expect(runGuidelines(['show', '2.1'], 'greenlight')).toContain('Guideline 2.1');
  });
});

describe('greenlightVersion', () => {
  it('returns the first line of version output', () => {
    mockExec.mockReturnValue(ok('greenlight v1.2.3\nbuilt today'));
    expect(greenlightVersion('greenlight')).toBe('greenlight v1.2.3');
  });

  it('returns null when the version cannot be read', () => {
    mockExec.mockReturnValue(fail());
    expect(greenlightVersion('greenlight')).toBeNull();
  });
});
