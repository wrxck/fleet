import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { findGreenlight, runPreflight, runGuidelines } from '../core/audit/greenlight';
import { resolveAuditTarget } from '../core/audit/target';
import { loadAuditCache, saveAuditRecord } from '../core/audit/cache';
import { loadAuditConfig, saveAuditConfig } from '../core/audit/config';
import { applySuppressions } from '../core/audit/suppress';
import type { AuditRecord } from '../core/audit/types';

function text(msg: string) {
  return { content: [{ type: 'text' as const, text: msg }] };
}

const INSTALL_NOTE =
  'greenlight binary not found. Install it with: ' +
  'go install github.com/RevylAI/greenlight/cmd/greenlight@latest ' +
  '(or set GREENLIGHT_BIN to an absolute path).';

export function registerAuditTools(server: McpServer): void {
  server.tool(
    'fleet_audit_run',
    'Run an App Store compliance audit on a mobile app project via greenlight preflight. ' +
    'Scans source code, the privacy manifest, and metadata for Apple App Store rejection ' +
    'risks. Target is a registered fleet app name or a path to a mobile project directory. ' +
    'Returns the full report (findings grouped by CRITICAL/WARN/INFO plus a pass/fail summary).',
    {
      target: z.string().describe('Registered app name or path to a mobile project directory'),
      ipaPath: z.string().optional().describe('Optional path to a built .ipa for binary inspection'),
    },
    async ({ target, ipaPath }) => {
      if (!findGreenlight()) return text(INSTALL_NOTE);

      const { target: resolved, projectPath } = resolveAuditTarget(target);

      let ipa: string | undefined;
      if (ipaPath) {
        ipa = resolve(ipaPath);
        if (!existsSync(ipa)) return text(`IPA file not found: ${ipa}`);
      }

      const raw = runPreflight(projectPath, { ipaPath: ipa });
      const { report, suppressed } = applySuppressions(
        raw, resolved, loadAuditConfig().ignore,
      );
      const record: AuditRecord = {
        target: resolved,
        projectPath,
        ...(ipa && { ipaPath: ipa }),
        ranAt: new Date().toISOString(),
        report,
      };
      saveAuditRecord(record);
      return text(JSON.stringify({ ...record, suppressed }, null, 2));
    },
  );

  server.tool(
    'fleet_audit_status',
    'Show the most recent App Store audit results from cache without re-running a scan. ' +
    'Returns cached audit records (summary plus findings). Use as a cheap first pass before ' +
    'fleet_audit_run.',
    { target: z.string().optional().describe('App name or path (omit for all cached audits)') },
    async ({ target }) => {
      const cache = loadAuditCache();
      const all = Object.values(cache.audits);
      if (all.length === 0) return text('No audits cached. Run fleet_audit_run first.');
      if (target) {
        const rec = cache.audits[target] ?? all.find(a => a.projectPath === resolve(target));
        if (!rec) return text(`No cached audit for "${target}". Run fleet_audit_run.`);
        return text(JSON.stringify(rec, null, 2));
      }
      return text(JSON.stringify(all, null, 2));
    },
  );

  server.tool(
    'fleet_audit_ignore',
    'Suppress a confirmed greenlight false positive from future audits. The finding is ' +
    'matched by its exact title, optionally narrowed to a target and to findings whose file ' +
    'or code contains a substring. Every rule must carry a reason. Suppressed findings are ' +
    'dropped and the pass/fail summary is recomputed on subsequent fleet_audit_run calls.',
    {
      title: z.string().describe('Exact greenlight finding title to suppress'),
      reason: z.string().describe('Why this finding is a false positive'),
      target: z.string().optional().describe('Limit the rule to one audit target'),
      contains: z.string().optional().describe('Only suppress findings whose file/code contains this substring'),
    },
    async ({ title, reason, target, contains }) => {
      const config = loadAuditConfig();
      config.ignore.push({
        ...(target && { target }),
        title,
        ...(contains && { contains }),
        reason,
        addedAt: new Date().toISOString(),
      });
      saveAuditConfig(config);
      return text(`Ignoring "${title}"${target ? ` for ${target}` : ''}: ${reason}`);
    },
  );

  server.tool(
    'fleet_audit_guidelines',
    'Look up Apple App Store Review Guidelines via greenlight. action "list" returns all ' +
    'sections, "show" returns one section (query is a section number like "2.1"), "search" ' +
    'matches a keyword (query is the term). Use to interpret a finding\'s guideline reference ' +
    'or to guide a fix.',
    {
      action: z.enum(['list', 'show', 'search']).describe('list, show, or search'),
      query: z.string().optional().describe('Section number for show (e.g. "2.1") or keyword for search'),
    },
    async ({ action, query }) => {
      if (!findGreenlight()) return text(INSTALL_NOTE);
      if ((action === 'show' || action === 'search') && !query) {
        return text(`'${action}' requires a query argument`);
      }
      const args = action === 'list' ? ['list'] : [action, query as string];
      return text(runGuidelines(args));
    },
  );
}
