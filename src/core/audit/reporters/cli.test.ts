import { describe, it, expect } from 'vitest';

import { formatReport } from './cli';
import type { GreenlightReport } from '../types';

function stripAnsi(s: string): string {
  return s.replace(/\x1b\[[0-9;]*m/g, '');
}

const base: GreenlightReport = {
  project_path: '/p',
  app_name: 'ShiftFaced',
  bundle_id: 'work.shiftfaced.app',
  has_privacy_info: true,
  findings: [],
  summary: { total: 0, critical: 0, warns: 0, infos: 0, passed: true },
  elapsed: '12ms',
};

describe('formatReport', () => {
  it('shows a GREENLIT verdict and project context when the summary passes', () => {
    const out = stripAnsi(formatReport(base).join('\n'));
    expect(out).toContain('GREENLIT');
    expect(out).toContain('ShiftFaced');
    expect(out).toContain('work.shiftfaced.app');
  });

  it('shows a NOT READY verdict with the finding when there is a critical', () => {
    const report: GreenlightReport = {
      ...base,
      has_privacy_info: false,
      findings: [
        {
          source: 'codescan',
          severity: 'CRITICAL',
          guideline: '2.1',
          title: 'Hardcoded API key',
          detail: 'a secret is committed to source',
          fix: 'move it into an environment variable',
          file: 'app/x.ts',
          line: 4,
        },
      ],
      summary: { total: 1, critical: 1, warns: 0, infos: 0, passed: false },
    };
    const out = stripAnsi(formatReport(report).join('\n'));
    expect(out).toContain('NOT READY');
    expect(out).toContain('Hardcoded API key');
    expect(out).toContain('§2.1');
    expect(out).toContain('app/x.ts:4');
    expect(out).toContain('move it into an environment variable');
  });

  it('groups findings under their severity headings', () => {
    const report: GreenlightReport = {
      ...base,
      findings: [
        { source: 'privacy', severity: 'WARN', title: 'Missing privacy manifest', detail: 'd' },
        { source: 'metadata', severity: 'INFO', title: 'No app icon set', detail: 'd' },
      ],
      summary: { total: 2, critical: 0, warns: 1, infos: 1, passed: true },
    };
    const out = stripAnsi(formatReport(report).join('\n'));
    expect(out).toContain('Warning');
    expect(out).toContain('Info');
  });
});
