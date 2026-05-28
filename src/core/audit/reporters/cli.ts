import { c, icon } from '../../../ui/output';
import type { GreenlightFinding, GreenlightReport } from '../types';

const SEVERITY_ORDER = ['CRITICAL', 'WARN', 'INFO'] as const;

export function severityIcon(severity: string): string {
  switch (severity) {
    case 'CRITICAL': return icon.err;
    case 'WARN': return icon.warn;
    default: return icon.info;
  }
}

function severityHeading(severity: string): string {
  switch (severity) {
    case 'CRITICAL': return `${c.red}${c.bold}Critical — will be rejected`;
    case 'WARN': return `${c.yellow}${c.bold}Warning — high rejection risk`;
    default: return `${c.dim}${c.bold}Info — best practice`;
  }
}

// render a parsed greenlight report into printable terminal lines, grouped by
// severity with a verdict footer. ansi colours come from ui/output.
export function formatReport(report: GreenlightReport): string[] {
  const lines: string[] = [];

  if (report.app_name) lines.push(`  ${c.dim}App${c.reset}     ${report.app_name}`);
  if (report.bundle_id) lines.push(`  ${c.dim}Bundle${c.reset}  ${report.bundle_id}`);
  lines.push(
    `  ${c.dim}Privacy manifest${c.reset}  ` +
    (report.has_privacy_info ? `${icon.ok} present` : `${icon.warn} missing`),
  );
  if (report.tracking_sdks && report.tracking_sdks.length > 0) {
    lines.push(`  ${c.dim}Tracking SDKs${c.reset}  ${report.tracking_sdks.join(', ')}`);
  }
  if (report.detected_apis && report.detected_apis.length > 0) {
    lines.push(`  ${c.dim}Required-reason APIs${c.reset}  ${report.detected_apis.join(', ')}`);
  }

  for (const severity of SEVERITY_ORDER) {
    const group = report.findings.filter(f => f.severity === severity);
    if (group.length === 0) continue;
    lines.push('');
    lines.push(`${severityHeading(severity)} (${group.length})${c.reset}`);
    for (const finding of group) lines.push(...formatFinding(finding));
  }

  const s = report.summary;
  lines.push('');
  lines.push(`  ${c.dim}${'-'.repeat(48)}${c.reset}`);
  if (s.passed) {
    lines.push(`  ${c.green}${c.bold}GREENLIT${c.reset} — no critical issues found`);
  } else {
    lines.push(`  ${c.red}${c.bold}NOT READY${c.reset} — ${s.critical} critical issue(s) must be fixed`);
  }
  lines.push(
    `  ${c.dim}${s.total} findings: ${s.critical} critical, ${s.warns} warn, ` +
    `${s.infos} info — scanned in ${report.elapsed}${c.reset}`,
  );
  return lines;
}

function formatFinding(finding: GreenlightFinding): string[] {
  const out: string[] = [];
  const ref = finding.guideline ? `${c.cyan}§${finding.guideline}${c.reset} ` : '';
  out.push(
    `  ${severityIcon(finding.severity)} ${c.dim}[${finding.source}]${c.reset} ` +
    `${ref}${c.bold}${finding.title}${c.reset}`,
  );
  if (finding.file) {
    const loc = finding.line ? `${finding.file}:${finding.line}` : finding.file;
    out.push(`      ${c.dim}${loc}${c.reset}`);
  }
  out.push(`      ${c.dim}${finding.detail}${c.reset}`);
  if (finding.fix) out.push(`      ${c.green}fix:${c.reset} ${finding.fix}`);
  return out;
}
