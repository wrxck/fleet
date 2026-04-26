import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

import { getStatusData } from '../commands/status.js';
import { load, findApp, save, addApp, type AppEntry } from '../core/registry.js';
import { startService, stopService, restartService } from '../core/systemd.js';
import { getContainerLogs, getContainersByCompose } from '../core/docker.js';
import { checkHealth, checkAllHealth } from '../core/health.js';
import { listSites, installConfig, testConfig, reload, removeConfig } from '../core/nginx.js';
import { generateNginxConfig } from '../templates/nginx.js';
import { composeBuild } from '../core/docker.js';
import { execSafe } from '../core/exec.js';
import { AppNotFoundError } from '../core/errors.js';
import { assertAppName, assertServiceName, assertFilePath, assertDomain } from '../core/validate.js';
import { loadManifest, listSecrets, isInitialized } from '../core/secrets.js';
import { unsealAll, getStatus as getSecretsStatus } from '../core/secrets-ops.js';
import { validateApp, validateAll } from '../core/secrets-validate.js';
import { freezeApp, unfreezeApp } from '../commands/freeze.js';
import { registerGitTools } from './git-tools.js';
import { registerSecretsTools } from './secrets-tools.js';
import { readContainerLogs, getLogStatus, effectivePolicy } from '../core/logs-policy.js';
import { snapshotEgress } from '../core/egress.js';
import { registerDepsTools } from './deps-tools.js';

function requireApp(name: string) {
  const reg = load();
  const app = findApp(reg, name);
  if (!app) throw new AppNotFoundError(name);
  return app;
}

function text(msg: string) {
  return { content: [{ type: 'text' as const, text: msg }] };
}

export async function startMcpServer(): Promise<void> {
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const pkg = JSON.parse(readFileSync(join(__dirname, '..', '..', 'package.json'), 'utf-8'));

  const server = new McpServer({
    name: 'fleet',
    version: pkg.version,
  });

  server.tool('fleet_status', 'Dashboard data for all apps: systemd state, containers, health', async () => {
    const data = getStatusData();
    return text(JSON.stringify(data, null, 2));
  });

  server.tool('fleet_list', 'List all registered apps with their configuration', async () => {
    const reg = load();
    return text(JSON.stringify(reg.apps, null, 2));
  });

  server.tool(
    'fleet_start',
    'Start an app via systemctl',
    { app: z.string().describe('App name') },
    async ({ app }) => {
      const entry = requireApp(app);
      const ok = startService(entry.serviceName);
      return text(ok ? `Started ${entry.name}` : `Failed to start ${entry.name}`);
    }
  );

  server.tool(
    'fleet_stop',
    'Stop an app via systemctl',
    { app: z.string().describe('App name') },
    async ({ app }) => {
      const entry = requireApp(app);
      const ok = stopService(entry.serviceName);
      return text(ok ? `Stopped ${entry.name}` : `Failed to stop ${entry.name}`);
    }
  );

  server.tool(
    'fleet_restart',
    'Restart an app via systemctl',
    { app: z.string().describe('App name') },
    async ({ app }) => {
      const entry = requireApp(app);
      const ok = restartService(entry.serviceName);
      return text(ok ? `Restarted ${entry.name}` : `Failed to restart ${entry.name}`);
    }
  );

  server.tool(
    'fleet_logs',
    'DEPRECATED — prefer fleet_logs_recent (token-conservative defaults) or fleet_logs_summary. Get recent container logs for an app.',
    {
      app: z.string().describe('App name'),
      container: z.string().optional().describe('Container name (omit to list available containers, or get logs from first)'),
      lines: z.number().optional().default(100).describe('Number of log lines'),
    },
    async ({ app, container, lines }) => {
      const entry = requireApp(app);
      if (entry.containers.length === 0) return text('No containers registered');
      if (!container && entry.containers.length > 1) {
        return text(
          `${entry.name} has ${entry.containers.length} containers. Specify one:\n` +
          entry.containers.map(c => `  - ${c}`).join('\n') +
          `\n\nOr omit container to get logs from: ${entry.containers[0]}`
        );
      }
      const target = container ?? entry.containers[0];
      if (!entry.containers.includes(target)) {
        return text(
          `Container "${target}" not found in ${entry.name}. Available:\n` +
          entry.containers.map(c => `  - ${c}`).join('\n')
        );
      }
      const logs = getContainerLogs(target, lines);
      return text(logs);
    }
  );

  // ── New token-conservative log tools ─────────────────────────────────────

  server.tool(
    'fleet_logs_recent',
    'Get recent log lines for an app, filtered to a level and bounded in size. Defaults are SMALL (50 lines, last 15 minutes, warn+) — broaden only if needed. Returns {text, truncated, suggestion}.',
    {
      app: z.string().describe('App name'),
      container: z.string().optional().describe('Container (defaults to first)'),
      lines: z.number().optional().default(50).describe('Tail N lines (default 50)'),
      level: z.enum(['debug', 'info', 'warn', 'error']).optional().default('warn').describe('Min level (default warn — drops debug/info noise)'),
      sinceMinutes: z.number().optional().default(15).describe('Look back this many minutes (default 15)'),
      grep: z.string().optional().describe('Substring filter applied after level'),
    },
    async ({ app, container, lines, level, sinceMinutes, grep }) => {
      const entry = requireApp(app);
      if (entry.containers.length === 0) return text('No containers registered');
      const target = container ?? entry.containers[0];
      if (!entry.containers.includes(target)) {
        return text(`Container "${target}" not in ${entry.name}. Have: ${entry.containers.join(', ')}`);
      }
      const result = readContainerLogs(target, { lines, level, sinceMinutes, grep, maxBytes: 200_000 });
      const suffix = result.truncated
        ? '\n\n[truncated at 200KB — narrow with smaller lines/sinceMinutes or add grep]'
        : '';
      return text(result.text + suffix);
    }
  );

  server.tool(
    'fleet_logs_summary',
    'Cheap aggregate: counts of log lines by level + the top 10 distinct error/warning messages over a window. Use as a first pass before fleet_logs_recent.',
    {
      app: z.string().describe('App name'),
      container: z.string().optional().describe('Container (defaults to first)'),
      sinceMinutes: z.number().optional().default(60).describe('Window in minutes (default 60)'),
    },
    async ({ app, container, sinceMinutes }) => {
      const entry = requireApp(app);
      const target = container ?? entry.containers[0];
      if (!entry.containers.includes(target)) {
        return text(`Container "${target}" not in ${entry.name}. Have: ${entry.containers.join(', ')}`);
      }
      const all = readContainerLogs(target, { lines: 5000, sinceMinutes, maxBytes: 5_000_000 });
      const lines = all.text.split('\n').filter(l => l.trim());
      const counts = { error: 0, warn: 0, info: 0, debug: 0, other: 0 };
      const errMsgs = new Map<string, number>();
      for (const ln of lines) {
        if (/error|err\b|fatal|critical|exception|panic/i.test(ln)) {
          counts.error++;
          // canonicalise: drop timestamps, IDs
          const norm = ln.replace(/\b[0-9a-f]{8,}\b/gi, '<id>')
                         .replace(/\b\d{4}-\d{2}-\d{2}T[\d:.]+Z?\b/g, '<ts>')
                         .replace(/\d+/g, 'N')
                         .slice(0, 200);
          errMsgs.set(norm, (errMsgs.get(norm) ?? 0) + 1);
        } else if (/warn|warning/i.test(ln)) counts.warn++;
        else if (/\binfo\b/i.test(ln)) counts.info++;
        else if (/\bdebug|trace|verbose\b/i.test(ln)) counts.debug++;
        else counts.other++;
      }
      const top = [...errMsgs.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([msg, n]) => `  ${n.toString().padStart(4)} × ${msg}`);
      const lines2 = [
        `Container: ${target}  Window: ${sinceMinutes}m  Total: ${lines.length} lines`,
        `By level: ${counts.error} error, ${counts.warn} warn, ${counts.info} info, ${counts.debug} debug, ${counts.other} other`,
        '',
        top.length ? 'Top distinct error/warn messages:' : 'No error/warn messages in window.',
        ...top,
      ];
      return text(lines2.join('\n'));
    }
  );

  server.tool(
    'fleet_logs_search',
    'Bounded grep across recent container logs. Returns matching lines with 0 lines of context, capped at max_results. Cheaper than fleet_logs_recent + manual filtering.',
    {
      app: z.string().describe('App name'),
      container: z.string().optional().describe('Container (defaults to first)'),
      query: z.string().describe('Substring or regex'),
      sinceMinutes: z.number().optional().default(60).describe('Window in minutes (default 60)'),
      maxResults: z.number().optional().default(20).describe('Cap results (default 20)'),
    },
    async ({ app, container, query, sinceMinutes, maxResults }) => {
      const entry = requireApp(app);
      const target = container ?? entry.containers[0];
      if (!entry.containers.includes(target)) {
        return text(`Container "${target}" not in ${entry.name}. Have: ${entry.containers.join(', ')}`);
      }
      const result = readContainerLogs(target, { lines: 5000, sinceMinutes, grep: query, maxBytes: 1_000_000 });
      const matches = result.text.split('\n').filter(l => l.trim());
      const slice = matches.slice(0, maxResults);
      const note = matches.length > maxResults
        ? `\n\n[${matches.length - maxResults} more matches — narrow query or shorten window]`
        : '';
      return text(slice.join('\n') + note);
    }
  );

  server.tool(
    'fleet_egress_snapshot',
    'Snapshot the current outbound TCP flows for an app and report which destinations are NOT in the configured allowlist. Use to seed allowlists or audit unexpected egress. v1 is observe-only — it never blocks traffic.',
    { app: z.string().describe('App name') },
    async ({ app }) => {
      const entry = requireApp(app);
      const snap = snapshotEgress(entry);
      return text(
        JSON.stringify(
          {
            takenAt: snap.takenAt,
            app: snap.app,
            uniqueRemotes: snap.uniqueRemotes,
            violations: snap.violations,
            flowCount: snap.flows.length,
          },
          null,
          2,
        ),
      );
    }
  );

  server.tool(
    'fleet_logs_status',
    'Per-container log driver, current size, and policy applied. Use to check which apps need fleet logs setup.',
    { app: z.string().optional().describe('App name (omit for all)') },
    async ({ app }) => {
      const reg = load();
      const apps = app ? [findApp(reg, app)].filter(Boolean) as AppEntry[] : reg.apps;
      const out: Array<Record<string, unknown>> = [];
      for (const a of apps) {
        const policy = effectivePolicy(a);
        const status = getLogStatus(a);
        for (const s of status) out.push({ ...s, sizeMB: s.totalBytes != null ? +(s.totalBytes / 1024 / 1024).toFixed(2) : null, policy });
      }
      return text(JSON.stringify(out, null, 2));
    }
  );

  server.tool(
    'fleet_health',
    'Run health checks for one or all apps',
    { app: z.string().optional().describe('App name (omit for all apps)') },
    async ({ app }) => {
      const reg = load();
      if (app) {
        const entry = findApp(reg, app);
        if (!entry) throw new AppNotFoundError(app);
        const result = checkHealth(entry);
        return text(JSON.stringify(result, null, 2));
      }
      const results = checkAllHealth(reg.apps);
      return text(JSON.stringify(results, null, 2));
    }
  );

  server.tool(
    'fleet_deploy',
    'Deploy an app: build and restart',
    { app: z.string().describe('App name') },
    async ({ app }) => {
      const entry = requireApp(app);
      const buildOk = composeBuild(entry.composePath, entry.composeFile, entry.name);
      if (!buildOk) return text(`Build failed for ${entry.name}`);
      const ok = restartService(entry.serviceName);
      return text(ok ? `Deployed ${entry.name}` : `Deploy failed for ${entry.name}`);
    }
  );

  server.tool(
    'fleet_nginx_add',
    'Create an nginx config for a domain',
    {
      domain: z.string().describe('Domain name'),
      port: z.number().describe('Backend port'),
      type: z.enum(['proxy', 'spa', 'nextjs']).optional().default('proxy').describe('Config type'),
    },
    async ({ domain, port, type }) => {
      const DANGEROUS_PORTS = [5432, 3306, 27017, 6379, 9000];
      if (port < 1024 || port > 65535) {
        return text(`Invalid port ${port}: must be in range 1024-65535`);
      }
      if (DANGEROUS_PORTS.includes(port)) {
        return text(`Port ${port} is not allowed (reserved for internal services)`);
      }
      const config = generateNginxConfig({ domain, port, type });
      installConfig(domain, config);
      const test = testConfig();
      if (!test.ok) {
        removeConfig(domain);
        return text(`Config test failed: ${test.output}`);
      }
      reload();
      return text(`Created and activated nginx config for ${domain}`);
    }
  );

  server.tool('fleet_nginx_list', 'List all nginx site configs', async () => {
    const sites = listSites();
    return text(JSON.stringify(sites, null, 2));
  });

  server.tool('fleet_secrets_status', 'Show vault initialisation state, sealed/unsealed, counts. The vault is the encrypted source of truth that survives reboots. Runtime (/run/fleet-secrets/) is the decrypted copy used by apps — it is lost on reboot.', async () => {
    const status = getSecretsStatus();
    return text(JSON.stringify(status, null, 2));
  });

  server.tool(
    'fleet_secrets_list',
    'List managed secrets for an app (masked values). Shows vault contents — use fleet_secrets_drift to check if runtime differs.',
    { app: z.string().optional().describe('App name (omit for all apps)') },
    async ({ app }) => {
      if (!isInitialized()) return text('Vault not initialised');
      if (app) {
        const secrets = listSecrets(app);
        return text(JSON.stringify(secrets, null, 2));
      }
      const manifest = loadManifest();
      return text(JSON.stringify(manifest.apps, null, 2));
    }
  );

  server.tool('fleet_secrets_unseal', 'Decrypt vault to /run/fleet-secrets/. WARNING: This overwrites any runtime changes that were not sealed back to the vault. Use fleet_secrets_drift first to check for unsaved changes.', async () => {
    if (!isInitialized()) return text('Vault not initialised');
    unsealAll();
    return text('Unsealed all secrets to /run/fleet-secrets/');
  });

  server.tool(
    'fleet_secrets_validate',
    'Validate compose secrets match vault. Returns missing/extra secrets per app. This checks that docker-compose secret references have matching entries in the vault.',
    { app: z.string().optional().describe('App name (omit for all apps)') },
    async ({ app }) => {
      if (!isInitialized()) return text('Vault not initialised');
      const results = app ? [validateApp(app)] : validateAll();
      return text(JSON.stringify(results, null, 2));
    }
  );

  server.tool(
    'fleet_register',
    'Register a new app in the fleet registry',
    {
      name: z.string().describe('App name (kebab-case identifier)'),
      composePath: z.string().describe('Absolute path to docker-compose directory'),
      displayName: z.string().optional().describe('Human-friendly name'),
      composeFile: z.string().optional().describe('Custom compose filename'),
      serviceName: z.string().optional().describe('Systemd service name'),
      domains: z.array(z.string()).optional().default([]).describe('Domain names'),
      port: z.number().optional().describe('Backend port'),
      type: z.enum(['proxy', 'spa', 'nextjs', 'service']).optional().default('service').describe('App type'),
      containers: z.array(z.string()).optional().describe('Container names (auto-detected if omitted)'),
      usesSharedDb: z.boolean().optional().default(false).describe('Uses shared database'),
      dependsOnDatabases: z.boolean().optional().default(false).describe('Depends on docker-databases'),
    },
    async (params) => {
      try {
        assertAppName(params.name);
        assertFilePath(params.composePath);
        if (params.serviceName) assertServiceName(params.serviceName);
        if (params.composeFile) assertFilePath(params.composeFile);
        for (const d of (params.domains ?? [])) assertDomain(d);
      } catch (err) {
        return text(`Validation error: ${(err as Error).message}`);
      }

      if (!existsSync(params.composePath)) {
        return text(`Error: composePath does not exist: ${params.composePath}`);
      }

      const reg = load();
      const existing = findApp(reg, params.name);

      let containers = params.containers;
      if (!containers || containers.length === 0) {
        containers = getContainersByCompose(params.composePath, params.composeFile ?? null);
        if (containers.length === 0) containers = [params.name];
      }

      const entry: AppEntry = {
        name: params.name,
        displayName: params.displayName ?? params.name,
        composePath: params.composePath,
        composeFile: params.composeFile ?? null,
        serviceName: params.serviceName ?? params.name,
        domains: params.domains,
        port: params.port ?? null,
        type: params.type,
        containers,
        usesSharedDb: params.usesSharedDb,
        dependsOnDatabases: params.dependsOnDatabases,
        registeredAt: new Date().toISOString(),
      };

      save(addApp(reg, entry));

      const action = existing ? 'Updated' : 'Registered';
      return text(`${action} app "${params.name}":\n${JSON.stringify(entry, null, 2)}`);
    }
  );

  server.tool(
    'fleet_freeze',
    'Freeze a crash-looping service: stop it, disable it, and mark it frozen in the registry. Requires manual unfreezing.',
    {
      app: z.string().describe('App name'),
      reason: z.string().optional().describe('Reason for freezing'),
    },
    async ({ app, reason }) => {
      freezeApp(app, reason);
      return text(`Frozen ${app}${reason ? `: ${reason}` : ''}`);
    }
  );

  server.tool(
    'fleet_unfreeze',
    'Unfreeze a frozen service: clear frozen state, enable and start the service.',
    { app: z.string().describe('App name') },
    async ({ app }) => {
      unfreezeApp(app);
      return text(`Unfrozen ${app} — service enabled and started`);
    }
  );

  server.tool(
    'fleet_rollback',
    'Roll back an app to its previous image (tagged <repo>:fleet-previous before the last build) and restart the service. Use this when a recent deploy or boot-refresh produced a broken image.',
    { app: z.string().describe('App name') },
    async ({ app }) => {
      const entry = requireApp(app);

      // Resolve current image name via compose config
      const config = execSafe(
        'docker',
        ['compose', ...(entry.composeFile ? ['-f', entry.composeFile] : []), 'config', '--images'],
        { cwd: entry.composePath, timeout: 15_000 },
      );
      if (!config.ok) return text(`Could not resolve image name for ${entry.name}: ${config.stderr}`);
      const latest = config.stdout.split('\n').filter(Boolean)[0];
      if (!latest) return text(`Could not resolve image name for ${entry.name}`);

      // Compute previous tag via lastIndexOf (handles registry:port/repo:tag)
      const lastColon = latest.lastIndexOf(':');
      const base = lastColon > 0 ? latest.slice(0, lastColon) : latest;
      const previous = `${base}:fleet-previous`;

      if (!execSafe('docker', ['image', 'inspect', previous], { timeout: 10_000 }).ok) {
        return text(`No previous image found (${previous}) — nothing to roll back to`);
      }
      const tag = execSafe('docker', ['tag', previous, latest], { timeout: 10_000 });
      if (!tag.ok) return text(`docker tag failed: ${tag.stderr}`);

      const ok = restartService(entry.serviceName);
      return text(ok
        ? `Rolled back ${entry.name} to ${previous}`
        : `Tag flipped but service restart failed for ${entry.serviceName}`,
      );
    },
  );

  registerGitTools(server);
  registerSecretsTools(server);
  registerDepsTools(server);

  const transport = new StdioServerTransport();
  await server.connect(transport);
}
