import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  findGreenlight, greenlightVersion, runPreflight, runGuidelines,
  GREENLIGHT_INSTALL_HINT,
} from '../core/audit/greenlight';
import { resolveAuditTarget } from '../core/audit/target';
import { saveAuditRecord } from '../core/audit/cache';
import { loadAuditConfig, saveAuditConfig } from '../core/audit/config';
import { applySuppressions } from '../core/audit/suppress';
import { formatReport } from '../core/audit/reporters/cli';
import { FleetError } from '../core/errors';
import { heading, success, error, info } from '../ui/output';
import type { AuditRecord } from '../core/audit/types';

// `fleet audit` — App Store compliance audits for mobile app projects, backed
// by the greenlight preflight scanner (RevylAI/greenlight).
export async function auditCommand(args: string[]): Promise<void> {
  const sub = args[0];
  switch (sub) {
    case 'guidelines': return auditGuidelines(args.slice(1));
    case 'doctor': return auditDoctor();
    case 'ignore': return auditIgnore(args.slice(1));
    case 'unignore': return auditUnignore(args.slice(1));
    case 'ignores': return auditIgnores();
    default: return auditRun(args);
  }
}

async function auditRun(args: string[]): Promise<void> {
  const json = args.includes('--json');
  const ipaFlag = extractFlag(args, '--ipa');
  const positional = args.filter(a => !a.startsWith('-'));
  const target = positional[0] ?? '.';

  if (!findGreenlight()) {
    error('greenlight binary not found');
    for (const line of GREENLIGHT_INSTALL_HINT.split('\n').slice(1)) info(line.trim());
    process.exit(1);
  }

  const { target: resolved, projectPath } = resolveAuditTarget(target);

  let ipaPath: string | undefined;
  if (ipaFlag) {
    ipaPath = resolve(ipaFlag);
    if (!existsSync(ipaPath)) throw new FleetError(`IPA file not found: ${ipaPath}`);
  }

  if (!json) {
    heading(`App Store Audit: ${resolved}`);
    info(`Scanning ${projectPath}${ipaPath ? ` (+ ${ipaPath})` : ''}`);
  }

  const raw = runPreflight(projectPath, { ipaPath });
  const { report, suppressed } = applySuppressions(
    raw, resolved, loadAuditConfig().ignore,
  );

  const record: AuditRecord = {
    target: resolved,
    projectPath,
    ...(ipaPath && { ipaPath }),
    ranAt: new Date().toISOString(),
    report,
  };
  saveAuditRecord(record);

  if (json) {
    process.stdout.write(JSON.stringify(record, null, 2) + '\n');
    return;
  }

  process.stdout.write('\n');
  for (const line of formatReport(report)) process.stdout.write(line + '\n');
  if (suppressed > 0) {
    info(`${suppressed} finding(s) suppressed by ignore rules — see: fleet audit ignores`);
  }
  process.stdout.write('\n');
}

async function auditGuidelines(args: string[]): Promise<void> {
  if (!findGreenlight()) {
    error('greenlight binary not found — run: fleet audit doctor');
    process.exit(1);
  }
  process.stdout.write(runGuidelines(args.length > 0 ? args : ['list']) + '\n');
}

async function auditDoctor(): Promise<void> {
  heading('Audit — greenlight status');
  const bin = findGreenlight();
  if (!bin) {
    error('greenlight binary not found');
    for (const line of GREENLIGHT_INSTALL_HINT.split('\n').slice(1)) info(line.trim());
    process.exit(1);
  }
  success(`greenlight found: ${bin}`);
  const version = greenlightVersion(bin);
  if (version) info(`version: ${version}`);
}

// `fleet audit ignore "<title>" --reason "..."` — suppress a confirmed
// greenlight false positive. matched by exact finding title, optionally
// narrowed to a target and to findings whose file/code contains a substring.
async function auditIgnore(args: string[]): Promise<void> {
  const title = args.find(a => !a.startsWith('-'));
  const reason = extractFlag(args, '--reason');
  const target = extractFlag(args, '--target');
  const contains = extractFlag(args, '--contains');

  if (!title || !reason) {
    error('Usage: fleet audit ignore "<finding title>" --reason "..." [--target <app>] [--contains <substr>]');
    process.exit(1);
  }

  const config = loadAuditConfig();
  config.ignore.push({
    ...(target && { target }),
    title,
    ...(contains && { contains }),
    reason,
    addedAt: new Date().toISOString(),
  });
  saveAuditConfig(config);
  success(`Ignoring "${title}"${target ? ` for ${target}` : ''}: ${reason}`);
}

async function auditUnignore(args: string[]): Promise<void> {
  const title = args.find(a => !a.startsWith('-'));
  const target = extractFlag(args, '--target');

  if (!title) {
    error('Usage: fleet audit unignore "<finding title>" [--target <app>]');
    process.exit(1);
  }

  const config = loadAuditConfig();
  const before = config.ignore.length;
  config.ignore = config.ignore.filter(
    rule => !(rule.title === title && (!target || rule.target === target)),
  );
  saveAuditConfig(config);
  success(`Removed ${before - config.ignore.length} ignore rule(s) for "${title}"`);
}

async function auditIgnores(): Promise<void> {
  heading('Audit — ignore rules');
  const { ignore } = loadAuditConfig();
  if (ignore.length === 0) {
    info('No ignore rules configured.');
    return;
  }
  for (const rule of ignore) {
    process.stdout.write(
      `  ${rule.title}` +
      `${rule.target ? ` [${rule.target}]` : ''}` +
      `${rule.contains ? ` (~${rule.contains})` : ''}\n` +
      `    ${rule.reason}\n`,
    );
  }
}

function extractFlag(args: string[], flag: string): string | undefined {
  const idx = args.indexOf(flag);
  if (idx === -1 || idx + 1 >= args.length) return undefined;
  return args[idx + 1];
}
