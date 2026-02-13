import { z } from 'zod';

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import { getStatusData } from '../commands/status.js';
import { load, findApp } from '../core/registry.js';
import { startService, stopService, restartService } from '../core/systemd.js';
import { getContainerLogs } from '../core/docker.js';
import { checkHealth, checkAllHealth } from '../core/health.js';
import { listSites, installConfig, testConfig, reload, removeConfig } from '../core/nginx.js';
import { generateNginxConfig } from '../templates/nginx.js';
import { composeBuild } from '../core/docker.js';
import { AppNotFoundError } from '../core/errors.js';
import { loadManifest, listSecrets, isInitialized } from '../core/secrets.js';
import { unsealAll, getStatus as getSecretsStatus } from '../core/secrets-ops.js';
import { validateApp, validateAll } from '../core/secrets-validate.js';
import { registerGitTools } from './git-tools.js';

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
  const server = new McpServer({
    name: 'fleet',
    version: '1.0.0',
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
    'Get recent container logs for an app',
    {
      app: z.string().describe('App name'),
      lines: z.number().optional().default(100).describe('Number of log lines'),
    },
    async ({ app, lines }) => {
      const entry = requireApp(app);
      const container = entry.containers[0];
      if (!container) return text('No containers registered');
      const logs = getContainerLogs(container, lines);
      return text(logs);
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
      const buildOk = composeBuild(entry.composePath, entry.composeFile);
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

  server.tool('fleet_secrets_status', 'Show vault initialisation state, sealed/unsealed, counts', async () => {
    const status = getSecretsStatus();
    return text(JSON.stringify(status, null, 2));
  });

  server.tool(
    'fleet_secrets_list',
    'List managed secrets for an app (masked values)',
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

  server.tool('fleet_secrets_unseal', 'Decrypt vault to /run/fleet-secrets/', async () => {
    if (!isInitialized()) return text('Vault not initialised');
    unsealAll();
    return text('Unsealed all secrets to /run/fleet-secrets/');
  });

  server.tool(
    'fleet_secrets_validate',
    'Validate compose secrets match vault. Returns missing/extra secrets per app.',
    { app: z.string().optional().describe('App name (omit for all apps)') },
    async ({ app }) => {
      if (!isInitialized()) return text('Vault not initialised');
      const results = app ? [validateApp(app)] : validateAll();
      return text(JSON.stringify(results, null, 2));
    }
  );

  registerGitTools(server);

  const transport = new StdioServerTransport();
  await server.connect(transport);
}
