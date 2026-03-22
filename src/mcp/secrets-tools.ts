import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { isInitialized } from '../core/secrets.js';
import { restoreVaultFile } from '../core/secrets.js';
import {
  setSecret, getSecret, sealFromRuntime, detectDrift,
} from '../core/secrets-ops.js';

function text(msg: string) {
  return { content: [{ type: 'text' as const, text: msg }] };
}

function requireVault() {
  if (!isInitialized()) throw new Error('Vault not initialised. Run: fleet secrets init');
}

export function registerSecretsTools(server: McpServer): void {
  server.tool(
    'fleet_secrets_set',
    'Set a single secret key/value for an app. ' +
    'IMPORTANT: This updates the encrypted vault directly. ' +
    'The change persists across reboots. ' +
    'If the app is running, you may also need to update the runtime env and restart the app.',
    {
      app: z.string().describe('App name'),
      key: z.string().describe('Secret key name (e.g. DATABASE_URL)'),
      value: z.string().describe('Secret value'),
    },
    async ({ app, key, value }) => {
      requireVault();
      setSecret(app, key, value);
      return text(`Set ${key} for ${app} in vault. Run fleet_secrets_unseal + restart the app to apply at runtime.`);
    },
  );

  server.tool(
    'fleet_secrets_get',
    'Get a single decrypted secret value from the vault. ' +
    'Returns the value stored in the encrypted vault, NOT the runtime value. ' +
    'Use fleet_secrets_drift to check if runtime differs from vault.',
    {
      app: z.string().describe('App name'),
      key: z.string().describe('Secret key name'),
    },
    async ({ app, key }) => {
      requireVault();
      const val = getSecret(app, key);
      if (val === null) return text(`Key not found: ${key}`);
      return text(val);
    },
  );

  server.tool(
    'fleet_secrets_seal',
    'Seal runtime secrets back to the encrypted vault. ' +
    'CRITICAL: If you modified environment variables at runtime (e.g. edited .env files in /run/fleet-secrets/), ' +
    'those changes will be LOST on reboot unless you seal them back to the vault with this tool. ' +
    'This re-encrypts the current runtime state into the vault so it persists across reboots.',
    {
      app: z.string().optional().describe('App name (omit to seal all apps)'),
    },
    async ({ app }) => {
      requireVault();
      const sealed = sealFromRuntime(app);
      return text(`Sealed ${sealed.length} app(s): ${sealed.join(', ')}. Changes will now persist across reboots.`);
    },
  );

  server.tool(
    'fleet_secrets_drift',
    'Detect drift between vault (encrypted, survives reboot) and runtime (/run/fleet-secrets/, lost on reboot). ' +
    'Shows which keys were added, removed, or changed at runtime but NOT sealed back to the vault. ' +
    'If drift is detected, use fleet_secrets_seal to persist changes, or fleet_secrets_unseal to revert runtime to vault state.',
    {
      app: z.string().optional().describe('App name (omit to check all apps)'),
    },
    async ({ app }) => {
      requireVault();
      const results = detectDrift(app);
      return text(JSON.stringify(results, null, 2));
    },
  );

  server.tool(
    'fleet_secrets_restore',
    'Restore vault from backup (.bak file). ' +
    'Backups are created automatically before any seal operation. ' +
    'Use this if a seal operation produced incorrect results and you want to revert to the previous vault state.',
    {
      app: z.string().describe('App name'),
    },
    async ({ app }) => {
      requireVault();
      const ok = restoreVaultFile(app);
      if (!ok) return text(`No backup found for ${app}`);
      return text(`Restored vault backup for ${app}. Run fleet_secrets_unseal to apply to runtime.`);
    },
  );
}
