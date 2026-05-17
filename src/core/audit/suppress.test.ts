import { describe, it, expect } from 'vitest';

import { applySuppressions } from './suppress';
import type { GreenlightFinding, GreenlightReport } from './types';

function report(findings: GreenlightFinding[]): GreenlightReport {
  const critical = findings.filter(f => f.severity === 'CRITICAL').length;
  return {
    project_path: '/p',
    has_privacy_info: true,
    findings,
    summary: {
      total: findings.length,
      critical,
      warns: findings.filter(f => f.severity === 'WARN').length,
      infos: findings.filter(f => f.severity === 'INFO').length,
      passed: critical === 0,
    },
    elapsed: '5ms',
  };
}

describe('applySuppressions', () => {
  it('returns the report untouched when there are no rules', () => {
    const r = report([{ source: 'codescan', severity: 'WARN', title: 'A', detail: 'd' }]);
    expect(applySuppressions(r, 'app', [])).toEqual({ report: r, suppressed: 0 });
  });

  it('drops a finding matched by title and recomputes the summary', () => {
    const r = report([
      { source: 'codescan', severity: 'WARN', title: 'Placeholder', detail: 'd' },
      { source: 'privacy', severity: 'WARN', title: 'Other', detail: 'd' },
    ]);
    const res = applySuppressions(r, 'app', [
      { title: 'Placeholder', reason: 'fp', addedAt: 't' },
    ]);
    expect(res.suppressed).toBe(1);
    expect(res.report.findings).toHaveLength(1);
    expect(res.report.summary.warns).toBe(1);
    expect(res.report.summary.total).toBe(1);
  });

  it('ignores a rule scoped to a different target', () => {
    const r = report([{ source: 'codescan', severity: 'WARN', title: 'A', detail: 'd' }]);
    const res = applySuppressions(r, 'app', [
      { target: 'other', title: 'A', reason: 'fp', addedAt: 't' },
    ]);
    expect(res.suppressed).toBe(0);
  });

  it('only suppresses findings whose code or file contains the substring', () => {
    const r = report([
      { source: 'codescan', severity: 'WARN', title: 'Platform', detail: 'd', code: '"/billing/googleplay/verify"' },
      { source: 'codescan', severity: 'WARN', title: 'Platform', detail: 'd', code: '"Android only"' },
    ]);
    const res = applySuppressions(r, 'app', [
      { title: 'Platform', contains: 'googleplay', reason: 'endpoint path', addedAt: 't' },
    ]);
    expect(res.suppressed).toBe(1);
    expect(res.report.findings[0].code).toBe('"Android only"');
  });

  it('flips passed to true when the only critical is suppressed', () => {
    const r = report([{ source: 'privacy', severity: 'CRITICAL', title: 'No manifest', detail: 'd' }]);
    expect(r.summary.passed).toBe(false);
    const res = applySuppressions(r, 'app', [
      { title: 'No manifest', reason: 'handled via app.json', addedAt: 't' },
    ]);
    expect(res.report.summary.passed).toBe(true);
    expect(res.report.summary.critical).toBe(0);
  });
});
