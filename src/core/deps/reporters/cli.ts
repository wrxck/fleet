import { c, icon } from '../../../ui/output.js';
import type { DepsCache, Finding, Severity } from '../types.js';

const SEVERITY_ORDER: Severity[] = ['critical', 'high', 'medium', 'low', 'info'];

export function severityIcon(severity: Severity): string {
  switch (severity) {
    case 'critical': return icon.err;
    case 'high': return icon.warn;
    case 'medium': return `${c.yellow}~${c.reset}`;
    case 'low': return `${c.dim}.${c.reset}`;
    case 'info': return icon.info;
  }
}

export function formatSummary(cache: DepsCache, appCount: number): string[] {
  const lines: string[] = [];
  const ago = formatAge(cache.lastScan);

  if (cache.findings.length === 0) {
    lines.push(`${icon.ok} All ${appCount} apps are up to date (scanned ${ago})`);
    return lines;
  }

  const byApp = new Map<string, Finding[]>();
  for (const f of cache.findings) {
    const arr = byApp.get(f.appName) ?? [];
    arr.push(f);
    byApp.set(f.appName, arr);
  }

  const rows: Array<{ name: string; findings: Finding[]; counts: Record<Severity, number> }> = [];
  for (const [app, findings] of byApp) {
    rows.push({ name: app, findings, counts: countBySeverity(findings) });
  }

  rows.sort((a, b) => severityWeight(b.findings) - severityWeight(a.findings));

  lines.push(`${c.dim}${appCount} apps, scanned ${ago}${c.reset}`);
  lines.push('');

  const header = `  ${'APP'.padEnd(24)}  ${'SCORE'.padEnd(5)}  ${'CRIT'.padEnd(4)}  ${'HIGH'.padEnd(4)}  ${'MED'.padEnd(4)}  LOW`;
  lines.push(`${c.bold}${header}${c.reset}`);
  lines.push(`  ${c.dim}${'-'.repeat(56)}${c.reset}`);

  for (const row of rows) {
    const score = healthScore(row.findings);
    const crit = row.counts.critical > 0 ? `${c.red}${row.counts.critical}${c.reset}` : `${c.dim}0${c.reset}`;
    const high = row.counts.high > 0 ? `${c.yellow}${row.counts.high}${c.reset}` : `${c.dim}0${c.reset}`;
    lines.push(`  ${c.bold}${row.name.padEnd(24)}${c.reset}  ${score}  ${padAnsi(crit, 4)}  ${padAnsi(high, 4)}  ${String(row.counts.medium).padEnd(4)}  ${row.counts.low}`);
  }

  const critical = cache.findings.filter(f => f.severity === 'critical');
  const high = cache.findings.filter(f => f.severity === 'high');

  if (critical.length > 0) {
    lines.push('');
    lines.push(`${c.red}${c.bold}Critical (${critical.length})${c.reset}`);
    for (const f of critical) {
      lines.push(`  ${icon.err} ${c.bold}${f.appName}${c.reset}: ${f.title}`);
    }
  }

  if (high.length > 0) {
    lines.push('');
    lines.push(`${c.yellow}${c.bold}High (${high.length})${c.reset}`);
    for (const f of high) {
      lines.push(`  ${icon.warn} ${c.bold}${f.appName}${c.reset}: ${f.title}`);
    }
  }

  return lines;
}

export function formatAppDetail(appName: string, findings: Finding[]): string[] {
  const lines: string[] = [];

  for (const severity of SEVERITY_ORDER) {
    const group = findings.filter(f => f.severity === severity);
    if (group.length === 0) continue;

    lines.push('');
    lines.push(`${c.bold}${severity.toUpperCase()} (${group.length})${c.reset}`);
    for (const f of group) {
      lines.push(`  ${severityIcon(f.severity)} ${f.title}`);
      lines.push(`    ${c.dim}${f.detail}${c.reset}`);
    }
  }

  if (findings.length === 0) {
    lines.push(`${icon.ok} ${appName} is fully up to date`);
  }

  return lines;
}

function healthScore(findings: Finding[]): string {
  const weights = findings.reduce((sum, f) => {
    switch (f.severity) {
      case 'critical': return sum + 4;
      case 'high': return sum + 3;
      case 'medium': return sum + 2;
      case 'low': return sum + 1;
      default: return sum;
    }
  }, 0);

  const score = Math.max(0, 5 - Math.ceil(weights / 4));
  const filled = `${c.green}${'#'.repeat(score)}${c.reset}`;
  const empty = `${c.dim}${'_'.repeat(5 - score)}${c.reset}`;
  return filled + empty;
}

function countBySeverity(findings: Finding[]): Record<Severity, number> {
  const counts: Record<Severity, number> = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
  for (const f of findings) counts[f.severity]++;
  return counts;
}

function severityWeight(findings: Finding[]): number {
  return findings.reduce((sum, f) => {
    const w: Record<Severity, number> = { critical: 1000, high: 100, medium: 10, low: 1, info: 0 };
    return sum + w[f.severity];
  }, 0);
}

function formatAge(isoDate: string): string {
  const ms = Date.now() - new Date(isoDate).getTime();
  const mins = Math.floor(ms / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function stripAnsi(str: string): string {
  return str.replace(/\x1b\[[0-9;]*m/g, '');
}

function padAnsi(str: string, width: number): string {
  const stripped = stripAnsi(str);
  const pad = Math.max(0, width - stripped.length);
  return str + ' '.repeat(pad);
}
