import { writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { execSafe } from '../core/exec.js';

import { SecretsError } from '../core/errors.js';
import { load, findApp } from '../core/registry.js';
import { initVault, getPublicKey, loadManifest, listSecrets } from '../core/secrets.js';
import { enumerateSecrets, enumerateAllSecrets, type EnrichedSecret } from '../core/secrets-metadata.js';
import {
  setSecret, getSecret, importEnvFile, importDbSecrets,
  exportApp, unsealAll, sealFromRuntime, rotateKey, getStatus,
  detectDrift,
} from '../core/secrets-ops.js';
import { restoreVaultFile } from '../core/secrets.js';
import { generateUnsealService } from '../templates/unseal.js';
import { validateApp, validateAll } from '../core/secrets-validate.js';
import { confirm } from '../ui/confirm.js';
import { c, heading, table, success, error, info, warn } from '../ui/output.js';

function getDbSecretsDir(): string {
  const reg = load();
  return join(reg.infrastructure.databases.composePath, 'secrets');
}

export async function secretsCommand(args: string[]): Promise<void> {
  const sub = args[0];
  const rest = args.slice(1);

  switch (sub) {
    case 'init': return secretsInit();
    case 'list': return secretsList(rest);
    case 'set': return secretsSet(rest);
    case 'get': return secretsGet(rest);
    case 'import': return secretsImport(rest);
    case 'export': return secretsExport(rest);
    case 'seal': return secretsSeal(rest);
    case 'unseal': return secretsUnseal();
    case 'rotate': return secretsRotate(rest);
    case 'ages': return secretsAges(rest);
    case 'validate': return secretsValidate(rest);
    case 'status': return secretsStatus(rest);
    case 'drift': return secretsDrift(rest);
    case 'restore': return secretsRestore(rest);
    case 'seal-runtime': return secretsSeal(rest);
    default:
      error('Usage: fleet secrets <init|list|set|get|import|export|seal|unseal|rotate|ages|validate|status|drift|restore>');
      process.exit(1);
  }
}

function secretsInit(): void {
  const pubkey = initVault();
  success(`Vault initialised`);
  info(`Public key: ${pubkey}`);

  const serviceContent = generateUnsealService();
  const servicePath = '/etc/systemd/system/fleet-unseal.service';
  writeFileSync(servicePath, serviceContent);
  execSafe('systemctl', ['daemon-reload']);
  execSafe('systemctl', ['enable', 'fleet-unseal']);
  success('Installed fleet-unseal.service');
}

function secretsList(args: string[]): void {
  const json = args.includes('--json');
  const appName = args.find(a => !a.startsWith('-'));

  if (appName) {
    const secrets = listSecrets(appName);
    if (json) {
      process.stdout.write(JSON.stringify(secrets, null, 2) + '\n');
      return;
    }
    heading(`Secrets: ${appName} (${secrets.length})`);
    const rows = secrets.map(s => [s.key, `${c.dim}${s.maskedValue}${c.reset}`]);
    table(['KEY', 'VALUE'], rows);
    process.stdout.write('\n');
    return;
  }

  const manifest = loadManifest();
  const entries = Object.entries(manifest.apps);

  if (json) {
    process.stdout.write(JSON.stringify(manifest.apps, null, 2) + '\n');
    return;
  }

  heading(`Managed Secrets (${entries.length} apps)`);
  const rows = entries.map(([name, entry]) => [
    `${c.bold}${name}${c.reset}`,
    entry.type,
    String(entry.keyCount),
    entry.lastSealedAt.substring(0, 19).replace('T', ' '),
  ]);
  table(['APP', 'TYPE', 'KEYS', 'LAST SEALED'], rows);
  process.stdout.write('\n');
}

function secretsSet(args: string[]): void {
  const [app, key, ...valueParts] = args;
  const value = valueParts.join(' ');
  if (!app || !key || !value) {
    error('Usage: fleet secrets set <app> <KEY> <VALUE>');
    process.exit(1);
  }
  setSecret(app, key, value);
  success(`Set ${key} for ${app}`);
}

function secretsGet(args: string[]): void {
  const [app, key] = args;
  if (!app || !key) {
    error('Usage: fleet secrets get <app> <KEY>');
    process.exit(1);
  }
  const val = getSecret(app, key);
  if (val === null) {
    error(`Key not found: ${key}`);
    process.exit(1);
  }
  process.stdout.write(val + '\n');
}

function secretsImport(args: string[]): void {
  const app = args.find(a => !a.startsWith('-'));
  const pathArg = args[1] && !args[1].startsWith('-') ? args[1] : null;

  if (!app) {
    error('Usage: fleet secrets import <app> [path]');
    process.exit(1);
  }

  if (app === 'docker-databases') {
    const dir = pathArg || getDbSecretsDir();
    const count = importDbSecrets(app, dir);
    success(`Imported ${count} secret files from ${dir}`);
    return;
  }

  const reg = load();
  const entry = findApp(reg, app);
  let envPath: string;

  if (pathArg) {
    envPath = pathArg;
  } else if (entry) {
    envPath = join(entry.composePath, '.env');
  } else {
    throw new SecretsError(`App not in registry and no path given: ${app}`);
  }

  const count = importEnvFile(app, envPath);
  success(`Imported ${count} keys from ${envPath}`);
}

function secretsExport(args: string[]): void {
  const app = args[0];
  if (!app) {
    error('Usage: fleet secrets export <app>');
    process.exit(1);
  }
  process.stdout.write(exportApp(app));
}

function secretsUnseal(): void {
  unsealAll();
  const manifest = loadManifest();
  const count = Object.keys(manifest.apps).length;
  success(`Unsealed ${count} apps to /run/fleet-secrets/`);
}

function secretsSeal(args: string[]): void {
  const app = args.find(a => !a.startsWith('-')) || undefined;
  const sealed = sealFromRuntime(app);
  for (const a of sealed) {
    success(`Sealed ${a}`);
  }
}

async function secretsRotate(args: string[]): Promise<void> {
  const yes = args.includes('-y') || args.includes('--yes');
  if (!yes && !await confirm('Rotate age key? This will re-encrypt all secrets.')) {
    info('Cancelled');
    return;
  }

  const result = rotateKey();
  success(`Key rotated`);
  info(`Old: ${result.oldPubkey}`);
  info(`New: ${result.newPubkey}`);
  info(`Re-encrypted ${result.appsRotated.length} apps`);
  warn('Run "fleet secrets unseal" to update runtime secrets');
}

interface AgesOpts { json: boolean; staleOnly: boolean; }

function parseAgesOpts(args: string[]): { app: string | undefined; opts: AgesOpts } {
  const opts: AgesOpts = {
    json: args.includes('--json'),
    staleOnly: args.includes('--stale-only') || args.includes('--stale'),
  };
  const app = args.find(a => !a.startsWith('-'));
  return { app, opts };
}

function statusLabel(s: ReturnType<typeof enumerateSecrets>[number]): string {
  if (!s.provider) return `${c.dim}unknown${c.reset}`;
  if (s.stale) return `${c.red}${c.bold}STALE${c.reset}`;
  if (s.ageDays != null) {
    const threshold = s.provider.rotationFrequencyDays * 0.8;
    if (s.ageDays >= threshold) return `${c.yellow}aging${c.reset}`;
  }
  return `${c.green}fresh${c.reset}`;
}

function ageString(days: number | null): string {
  if (days == null) return '?';
  if (days === 0) return 'today';
  if (days === 1) return '1 day';
  return `${days} days`;
}

function secretsAges(args: string[]): void {
  const { app, opts } = parseAgesOpts(args);

  let secrets: Array<EnrichedSecret & { app: string }>;
  if (app) {
    secrets = enumerateSecrets(app).map(s => ({ app, ...s }));
  } else {
    secrets = enumerateAllSecrets();
  }

  if (opts.staleOnly) {
    secrets = secrets.filter(s => s.stale);
  }

  if (opts.json) {
    // Strip the `provider` ProviderDef object (RegExp inside) for JSON-safety;
    // expose just its id, sensitivity, frequency.
    const out = secrets.map(s => ({
      app: s.app,
      name: s.name,
      lastRotated: s.lastRotated,
      ageDays: s.ageDays,
      stale: s.stale,
      provider: s.provider
        ? {
            id: s.provider.id,
            name: s.provider.name,
            sensitivity: s.provider.sensitivity,
            rotationFrequencyDays: s.provider.rotationFrequencyDays,
            strategy: s.provider.strategy,
          }
        : null,
    }));
    process.stdout.write(JSON.stringify(out, null, 2) + '\n');
    return;
  }

  if (secrets.length === 0) {
    if (opts.staleOnly) {
      success('No stale secrets — everything is within rotation frequency');
    } else if (app) {
      warn(`No secrets in ${app}`);
    } else {
      warn('No secrets in vault');
    }
    return;
  }

  // Sort: stale first (by sensitivity desc), then aging, then fresh.
  const sensRank: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
  secrets.sort((a, b) => {
    if (a.stale !== b.stale) return a.stale ? -1 : 1;
    const sa = sensRank[a.provider?.sensitivity ?? 'low'] ?? 99;
    const sb = sensRank[b.provider?.sensitivity ?? 'low'] ?? 99;
    if (sa !== sb) return sa - sb;
    if ((b.ageDays ?? 0) !== (a.ageDays ?? 0)) return (b.ageDays ?? 0) - (a.ageDays ?? 0);
    return a.app.localeCompare(b.app) || a.name.localeCompare(b.name);
  });

  const title = app ? `Secret ages: ${app}` : `Secret ages (${secrets.length} secrets)`;
  heading(title);

  const cols = app
    ? ['SECRET', 'AGE', 'ROTATE EVERY', 'PROVIDER', 'SENS', 'STATUS']
    : ['APP', 'SECRET', 'AGE', 'ROTATE EVERY', 'PROVIDER', 'SENS', 'STATUS'];

  const rows = secrets.map(s => {
    const provider = s.provider?.name ?? `${c.dim}—${c.reset}`;
    const freq = s.provider ? `${s.provider.rotationFrequencyDays}d` : '—';
    const sens = s.provider?.sensitivity ?? '—';
    const ageCol = ageString(s.ageDays);
    const status = statusLabel(s);
    return app
      ? [s.name, ageCol, freq, provider, sens, status]
      : [`${c.bold}${s.app}${c.reset}`, s.name, ageCol, freq, provider, sens, status];
  });

  table(cols, rows);
  process.stdout.write('\n');

  const staleCount = secrets.filter(s => s.stale).length;
  if (staleCount > 0) {
    warn(`${staleCount} secret(s) need rotation. Run: fleet secrets rotate <app>`);
  }
}

function secretsValidate(args: string[]): void {
  const json = args.includes('--json');
  const appName = args.find(a => !a.startsWith('-'));

  const results = appName ? [validateApp(appName)] : validateAll();

  if (json) {
    process.stdout.write(JSON.stringify(results, null, 2) + '\n');
    return;
  }

  heading('Secrets Validation');
  let failures = 0;

  for (const r of results) {
    if (r.missing.length === 0 && r.extra.length === 0) {
      if (r.ok) {
        info(`${c.green}ok${c.reset}  ${r.app}`);
      }
      continue;
    }

    if (r.missing.length > 0) {
      failures++;
      error(`${r.app}: missing from vault: ${r.missing.join(', ')}`);
    }
    if (r.extra.length > 0) {
      warn(`${r.app}: extra in vault (not in compose): ${r.extra.join(', ')}`);
    }
  }

  process.stdout.write('\n');
  if (failures > 0) {
    error(`${failures} app(s) have missing secrets`);
    process.exit(1);
  }
  success('All secrets validated');
}

function secretsStatus(args: string[]): void {
  const json = args.includes('--json');
  const status = getStatus();

  if (json) {
    process.stdout.write(JSON.stringify(status, null, 2) + '\n');
    return;
  }

  heading('Secrets Status');
  const stateLabel = status.initialized
    ? `${c.green}initialised${c.reset}`
    : `${c.red}not initialised${c.reset}`;
  const sealLabel = status.sealed
    ? `${c.yellow}sealed${c.reset}`
    : `${c.green}unsealed${c.reset}`;

  info(`Vault: ${stateLabel}`);
  info(`State: ${sealLabel}`);
  info(`Key:   ${status.keyPath}`);
  info(`Vault: ${status.vaultDir}`);
  info(`Runtime: ${status.runtimeDir}`);
  info(`Apps: ${status.appCount} | Keys: ${status.totalKeys}`);
  process.stdout.write('\n');
}

function secretsDrift(args: string[]): void {
  const json = args.includes('--json');
  const appName = args.find(a => !a.startsWith('-')) || undefined;

  const results = detectDrift(appName);

  if (json) {
    process.stdout.write(JSON.stringify(results, null, 2) + '\n');
    return;
  }

  heading('Vault / Runtime Drift');
  let hasDrift = false;

  for (const r of results) {
    if (r.status === 'in-sync') {
      info(`${c.green}in-sync${c.reset}  ${r.app}`);
      continue;
    }

    if (r.status === 'missing-runtime') {
      warn(`${r.app}: no runtime secrets (sealed or never unsealed)`);
      continue;
    }

    hasDrift = true;
    error(`${r.app}: drifted`);
    if (r.addedKeys.length > 0) info(`  added at runtime: ${r.addedKeys.join(', ')}`);
    if (r.removedKeys.length > 0) info(`  removed at runtime: ${r.removedKeys.join(', ')}`);
    if (r.changedKeys.length > 0) info(`  changed at runtime: ${r.changedKeys.join(', ')}`);
  }

  process.stdout.write('\n');
  if (hasDrift) {
    warn('Run "fleet secrets seal" to persist runtime changes to vault');
    warn('Run "fleet secrets unseal" to revert runtime to vault state');
  } else {
    success('No drift detected');
  }
}

function secretsRestore(args: string[]): void {
  const app = args.find(a => !a.startsWith('-'));
  if (!app) {
    error('Usage: fleet secrets restore <app>');
    process.exit(1);
  }

  const ok = restoreVaultFile(app);
  if (!ok) {
    error(`No backup found for ${app}`);
    process.exit(1);
  }
  success(`Restored vault backup for ${app}`);
  info('Run "fleet secrets unseal" to apply to runtime');
}
