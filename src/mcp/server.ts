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
import { AppNotFoundError } from '../core/errors.js';
import { loadManifest, listSecrets, isInitialized } from '../core/secrets.js';
import { unsealAll, getStatus as getSecretsStatus } from '../core/secrets-ops.js';
import { validateApp, validateAll } from '../core/secrets-validate.js';
import { freezeApp, unfreezeApp } from '../commands/freeze.js';
import { registerGitTools } from './git-tools.js';
import { registerSecretsTools } from './secrets-tools.js';
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

  registerGitTools(server);
  registerSecretsTools(server);
  registerDepsTools(server);

  const transport = new StdioServerTransport();
  await server.connect(transport);
}
