import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { resolveTestflightTarget, appSecretsEnv } from '../core/testflight/resolve';
import { resolveAscCredentials, hasAscCredentials } from '../core/testflight/credentials';
import { listBuilds, verifyApp } from '../core/testflight/asc';
import { ghVersion, resolveRepo } from '../core/testflight/workflow';

function text(msg: string) {
  return { content: [{ type: 'text' as const, text: msg }] };
}

export function registerTestflightTools(server: McpServer): void {
  server.tool(
    'fleet_testflight_builds',
    "List an app's TestFlight builds via the App Store Connect API — build number, " +
    'version, processing state and expiry. Requires the app\'s ASC credentials and ' +
    'ASC_APP_ID in its fleet secrets.',
    { app: z.string().describe('Registered fleet app name') },
    async ({ app }) => {
      const { app: name } = resolveTestflightTarget(app);
      const env = appSecretsEnv(name);
      if (!hasAscCredentials(env)) {
        return text(`App Store Connect credentials missing for ${name}.`);
      }
      const ascAppId = env.ASC_APP_ID;
      if (!ascAppId) return text(`ASC_APP_ID not set for ${name}.`);
      const builds = await listBuilds(resolveAscCredentials(env), ascAppId);
      return text(JSON.stringify(builds, null, 2));
    },
  );

  server.tool(
    'fleet_testflight_doctor',
    'Check TestFlight publishing readiness for an app: GitHub CLI availability, the ' +
    'GitHub repo backing the build workflow, App Store Connect credentials, and — when ' +
    'ASC_APP_ID is set — that the ASC API is reachable.',
    { app: z.string().describe('Registered fleet app name') },
    async ({ app }) => {
      const { app: name, projectPath } = resolveTestflightTarget(app);
      const env = appSecretsEnv(name);
      const lines = [
        `gh cli: ${ghVersion() ?? 'not found'}`,
        `github repo: ${resolveRepo(projectPath) ?? 'not resolved'}`,
      ];
      if (!hasAscCredentials(env)) {
        lines.push('asc credentials: missing — need ASC_API_KEY_ID, ASC_API_KEY_ISSUER_ID, ASC_API_KEY_B64');
        return text(lines.join('\n'));
      }
      lines.push('asc credentials: present');
      if (env.ASC_APP_ID) {
        try {
          const appName = await verifyApp(resolveAscCredentials(env), env.ASC_APP_ID);
          lines.push(`asc api: reachable — app "${appName}"`);
        } catch (err) {
          lines.push(`asc api: check failed — ${(err as Error).message}`);
        }
      } else {
        lines.push('asc app id: not set');
      }
      return text(lines.join('\n'));
    },
  );
}
