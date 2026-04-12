import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { load, findApp } from '../core/registry.js';
import { loadConfig, saveConfig } from '../core/deps/config.js';
import { loadCache, saveCache } from '../core/deps/cache.js';
import { runScan } from '../core/deps/scanner.js';
import { createDepsPr } from '../core/deps/actors/pr-creator.js';
import { AppNotFoundError } from '../core/errors.js';

function text(msg: string) {
  return { content: [{ type: 'text' as const, text: msg }] };
}

export function registerDepsTools(server: McpServer): void {
  server.tool(
    'fleet_deps_status',
    'Dependency health summary from cache — outdated packages, CVEs, EOL warnings, Docker image updates',
    async () => {
      const cache = loadCache();
      if (!cache) return text('No scan data. Run fleet deps scan first.');
      return text(JSON.stringify(cache, null, 2));
    }
  );

  server.tool(
    'fleet_deps_scan',
    'Run a fresh dependency scan across all registered apps',
    async () => {
      const reg = load();
      const config = loadConfig();
      const cache = await runScan(reg.apps, config);
      saveCache(cache);
      return text(JSON.stringify({
        findings: cache.findings.length,
        errors: cache.errors.length,
        duration: cache.scanDurationMs,
        apps: reg.apps.length,
      }, null, 2));
    }
  );

  server.tool(
    'fleet_deps_app',
    'Dependency findings for a specific app',
    { app: z.string().describe('App name') },
    async ({ app }) => {
      const cache = loadCache();
      if (!cache) return text('No scan data. Run fleet deps scan first.');
      const reg = load();
      const entry = findApp(reg, app);
      if (!entry) throw new AppNotFoundError(app);
      const findings = cache.findings.filter(f => f.appName === entry.name);
      return text(JSON.stringify(findings, null, 2));
    }
  );

  server.tool(
    'fleet_deps_fix',
    'Create a PR with dependency updates for an app (dry-run by default)',
    {
      app: z.string().describe('App name'),
      dryRun: z.boolean().default(true).describe('Preview changes without creating PR'),
    },
    async ({ app, dryRun }) => {
      const reg = load();
      const entry = findApp(reg, app);
      if (!entry) throw new AppNotFoundError(app);
      const cache = loadCache();
      if (!cache) return text('No scan data. Run fleet deps scan first.');
      const findings = cache.findings.filter(f => f.appName === entry.name && f.fixable);
      const result = createDepsPr(entry, findings, dryRun);
      return text(JSON.stringify(result, null, 2));
    }
  );

  server.tool(
    'fleet_deps_ignore',
    'Add an ignore rule for a dependency finding',
    {
      package: z.string().describe('Package name to ignore'),
      reason: z.string().describe('Why this is being ignored'),
      app: z.string().optional().describe('Limit to specific app'),
      until: z.string().optional().describe('Auto-expire date (YYYY-MM-DD)'),
    },
    async (params) => {
      const config = loadConfig();
      config.ignore.push({
        package: params.package, reason: params.reason,
        ...(params.app && { appName: params.app }),
        ...(params.until && { until: params.until }),
      });
      saveConfig(config);
      return text(`Ignoring ${params.package}: ${params.reason}`);
    }
  );

  const ALLOWED_CONFIG_KEYS = new Set([
    'scanIntervalHours', 'concurrency',
  ]);

  server.tool(
    'fleet_deps_config',
    'Get or set dependency monitoring configuration',
    { key: z.string().optional(), value: z.string().optional() },
    async ({ key, value }) => {
      const config = loadConfig();
      if (!key) return text(JSON.stringify(config, null, 2));
      if (!value) {
        if (!ALLOWED_CONFIG_KEYS.has(key)) return text(`Unknown config key: ${key}`);
        return text(JSON.stringify((config as unknown as Record<string, unknown>)[key], null, 2));
      }
      if (!ALLOWED_CONFIG_KEYS.has(key)) return text(`Cannot set key: ${key}. Allowed: ${[...ALLOWED_CONFIG_KEYS].join(', ')}`);
      (config as unknown as Record<string, unknown>)[key] = value === 'true' ? true : value === 'false' ? false : isNaN(Number(value)) ? value : Number(value);
      saveConfig(config);
      return text(`Set ${key} = ${value}`);
    }
  );
}
