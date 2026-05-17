import type {
  AuditIgnoreRule, GreenlightFinding, GreenlightReport, GreenlightSummary,
} from './types';

export interface SuppressionResult {
  // the report with suppressed findings dropped and the summary recomputed
  report: GreenlightReport;
  // how many findings the ignore rules removed
  suppressed: number;
}

// true when `rule` dismisses `finding` for the audit target `target`.
function ruleCovers(rule: AuditIgnoreRule, finding: GreenlightFinding, target: string): boolean {
  if (rule.target && rule.target !== target) return false;
  if (rule.title !== finding.title) return false;
  if (rule.contains) {
    const haystack = `${finding.file ?? ''}\n${finding.code ?? ''}`;
    if (!haystack.includes(rule.contains)) return false;
  }
  return true;
}

function recomputeSummary(findings: GreenlightFinding[]): GreenlightSummary {
  return {
    total: findings.length,
    critical: findings.filter(f => f.severity === 'CRITICAL').length,
    warns: findings.filter(f => f.severity === 'WARN').length,
    infos: findings.filter(f => f.severity === 'INFO').length,
    passed: findings.every(f => f.severity !== 'CRITICAL'),
  };
}

// drops findings covered by an active ignore rule and recomputes the summary
// so the verdict reflects what is left. this is how confirmed scanner false
// positives are dismissed — each rule carries a written reason.
export function applySuppressions(
  report: GreenlightReport,
  target: string,
  rules: AuditIgnoreRule[],
): SuppressionResult {
  if (rules.length === 0) return { report, suppressed: 0 };

  const kept = report.findings.filter(
    finding => !rules.some(rule => ruleCovers(rule, finding, target)),
  );
  const suppressed = report.findings.length - kept.length;
  if (suppressed === 0) return { report, suppressed: 0 };

  return {
    report: { ...report, findings: kept, summary: recomputeSummary(kept) },
    suppressed,
  };
}
