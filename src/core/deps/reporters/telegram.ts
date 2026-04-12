import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Finding, Severity } from '../types.js';
import { loadTelegramConfig, sendTelegram } from '../../telegram.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const NOTIFIED_PATH = join(__dirname, '..', '..', '..', '..', 'data', 'notified-findings.json');

export function formatTelegramMessage(findings: Finding[], appCount: number): string {
  if (findings.length === 0) return '';

  const lines: string[] = [];
  const date = new Date().toISOString().split('T')[0];
  lines.push(`<b>Fleet Deps Scan — ${date}</b>\n`);

  const groups: Record<Severity, Finding[]> = {
    critical: [], high: [], medium: [], low: [], info: [],
  };
  for (const f of findings) groups[f.severity].push(f);

  for (const severity of ['critical', 'high', 'medium', 'low'] as Severity[]) {
    const group = groups[severity];
    if (group.length === 0) continue;

    lines.push(`<b>${severity.charAt(0).toUpperCase() + severity.slice(1)} (${group.length}):</b>`);
    for (const f of group.slice(0, 10)) {
      lines.push(`• ${f.appName}: ${escapeHtml(f.title)}`);
    }
    if (group.length > 10) {
      lines.push(`  <i>...and ${group.length - 10} more</i>`);
    }
    lines.push('');
  }

  const totalApps = new Set(findings.map(f => f.appName)).size;
  lines.push(`${totalApps} apps affected out of ${appCount}`);

  return lines.join('\n');
}

export function findNewFindings(current: Finding[], previous: Finding[]): Finding[] {
  const severityOrder = ['info', 'low', 'medium', 'high', 'critical'];
  return current.filter(f => {
    const prev = previous.find(p => p.appName === f.appName && p.title === f.title);
    if (!prev) return true;
    return severityOrder.indexOf(f.severity) > severityOrder.indexOf(prev.severity);
  });
}

export async function sendTelegramNotification(
  findings: Finding[],
  appCount: number,
  previousFindings: Finding[],
  minSeverity: Severity,
): Promise<boolean> {
  const config = loadTelegramConfig();
  if (!config) return false;

  const newFindings = findNewFindings(findings, previousFindings);
  if (newFindings.length === 0) return false;

  const severityOrder = ['info', 'low', 'medium', 'high', 'critical'];
  const minIdx = severityOrder.indexOf(minSeverity);
  const filtered = newFindings.filter(f => severityOrder.indexOf(f.severity) >= minIdx);
  if (filtered.length === 0) return false;

  const message = formatTelegramMessage(filtered, appCount);
  if (!message) return false;

  return sendTelegram(config, message);
}

export function loadNotifiedFindings(): Finding[] {
  if (!existsSync(NOTIFIED_PATH)) return [];
  try {
    return JSON.parse(readFileSync(NOTIFIED_PATH, 'utf-8')) as Finding[];
  } catch {
    return [];
  }
}

export function saveNotifiedFindings(findings: Finding[]): void {
  const dir = dirname(NOTIFIED_PATH);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(NOTIFIED_PATH, JSON.stringify(findings, null, 2) + '\n');
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
