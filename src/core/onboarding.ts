import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { load, findApp, type AppEntry, type Registry } from './registry';
import { readServiceFile, getServiceStatus, systemdAvailable } from './systemd';
import { isInitialized, loadManifest, listSecrets, RUNTIME_DIR } from './secrets';
import { listSites } from './nginx';
import { execSafe } from './exec';
import { analyzeCompose, resolveComposeFile, type ComposeAnalysis } from './compose-analysis';

export interface OnboardingFix {
  runner: 'mcp' | 'cli' | 'operator-root';
  command: string;
}

export interface OnboardingCheck {
  id: string;
  title: string;
  status: 'ok' | 'missing' | 'warn' | 'skip';
  detail: string;
  fix?: OnboardingFix;
  /** a 'missing' here fails `fleet onboard` (and the deploy preflight) */
  blocking?: boolean;
}

export interface OnboardingReport {
  app: string;
  checks: OnboardingCheck[];
  /** true when no blocking check is missing */
  ok: boolean;
}

function toReport(app: string, checks: OnboardingCheck[]): OnboardingReport {
  return { app, checks, ok: !checks.some(ch => ch.blocking && ch.status === 'missing') };
}

/** printf template an operator (root) runs to seed one vault key — the
 *  $VALUE placeholder is deliberate; never interpolate a real value here. */
export function seedKeyFix(app: string, key: string): OnboardingFix {
  return {
    runner: 'operator-root',
    command: `printf '%s' "$VALUE" | sudo fleet secrets set ${app} ${key} --from-stdin`,
  };
}

export const UNIT_FIX = (app: string): OnboardingFix =>
  ({ runner: 'mcp', command: `fleet_service_install { app: "${app}" }` });
export const UNSEAL_FIX: OnboardingFix = { runner: 'mcp', command: 'fleet_secrets_unseal' };

/** key NAMES in the app's vault entry. never values. returns null when the
 *  names cannot be enumerated (vault sealed to this caller, decrypt failed). */
function vaultKeyNames(app: string): string[] | null {
  try {
    return listSecrets(app).map(s => s.key);
  } catch {
    try {
      const entry = loadManifest().apps[app];
      if (entry?.secrets) return Object.keys(entry.secrets);
    } catch { /* fall through */ }
    return null;
  }
}

function composeChecks(app: AppEntry, reg: Registry, analysis: ComposeAnalysis, checks: OnboardingCheck[]): void {
  if (analysis.yamlParseFailed) {
    checks.push({
      id: 'compose-yaml', title: 'Compose YAML', status: 'warn',
      detail: 'yaml parse failed — build args, project name and ports were not analysed',
    });
  }

  const needed = [...new Set([...analysis.requiredVars, ...analysis.buildArgVars])].sort();
  checks.push({
    id: 'compose-env', title: 'Compose env vars',
    status: needed.length === 0 ? 'skip' : 'ok',
    detail: needed.length === 0
      ? 'compose requires no env vars'
      : `required: ${analysis.requiredVars.join(', ') || '(none)'}; ` +
        `build args: ${analysis.buildArgVars.join(', ') || '(none)'}; ` +
        `defaulted: ${analysis.defaultedVars.join(', ') || '(none)'}`,
  });

  const clashes = reg.apps
    .filter(o => o.name !== app.name && o.port !== null)
    .filter(o => analysis.hostPorts.includes(o.port as number) || (app.port !== null && app.port === o.port))
    .map(o => `${o.port} (used by ${o.name})`);
  checks.push(clashes.length > 0
    ? {
        id: 'port-clash', title: 'Host port clash', status: 'warn',
        detail: `compose publishes a host port another registered app already uses: ${clashes.join(', ')}`,
        fix: { runner: 'operator-root', command: 'change the host port in the compose file, then update the registry port' },
      }
    : { id: 'port-clash', title: 'Host port clash', status: 'ok', detail: 'no clash with other registered apps' });

  const siblings = reg.apps.filter(a => a.name !== app.name && a.composePath === app.composePath);
  if (siblings.length > 0 && !analysis.projectName) {
    checks.push({
      id: 'project-name', title: 'Compose project name', status: 'warn',
      detail: `no explicit 'name:' in the compose file, and ${siblings.map(s => s.name).join(', ')} ` +
        `share this directory — the projects collide, so 'down' on one tears down the other`,
      fix: { runner: 'operator-root', command: `add a unique top-level 'name:' to ${app.composeFile ?? 'docker-compose.yml'}` },
    });
  } else {
    checks.push({
      id: 'project-name', title: 'Compose project name',
      status: analysis.projectName || siblings.length > 0 ? 'ok' : 'skip',
      detail: analysis.projectName
        ? `explicit project name '${analysis.projectName}'`
        : 'no other app shares this compose directory',
    });
  }
}

function unitChecks(app: AppEntry, checks: OnboardingCheck[]): void {
  try {
    if (readServiceFile(app.serviceName) === null) {
      checks.push({
        id: 'unit', title: 'Systemd unit', status: 'missing', blocking: true,
        detail: `${app.serviceName}.service does not exist — 'fleet deploy' will fail with "Unit not found". ` +
          `cli: sudo fleet service install ${app.name}`,
        fix: UNIT_FIX(app.name),
      });
      return;
    }
    checks.push({ id: 'unit', title: 'Systemd unit', status: 'ok', detail: `${app.serviceName}.service exists` });
    if (systemdAvailable()) {
      const status = getServiceStatus(app.serviceName);
      checks.push(status.enabled
        ? { id: 'unit-enabled', title: 'Unit enabled', status: 'ok', detail: 'enabled at boot' }
        : {
            id: 'unit-enabled', title: 'Unit enabled', status: 'warn',
            detail: 'unit exists but is not enabled — the app will not start at boot',
            fix: { runner: 'cli', command: `sudo systemctl enable ${app.serviceName}.service` },
          });
    }
  } catch (err) {
    checks.push({
      id: 'unit', title: 'Systemd unit', status: 'warn',
      detail: `could not inspect the unit: ${err instanceof Error ? err.message : String(err)}`,
    });
  }
}

function vaultChecks(app: AppEntry, needed: string[], checks: OnboardingCheck[]): void {
  if (needed.length === 0) {
    checks.push({ id: 'vault', title: 'Vault entry', status: 'skip', detail: 'compose requires no env vars' });
    checks.push({ id: 'runtime-env', title: 'Runtime env file', status: 'skip', detail: 'compose requires no env vars' });
    return;
  }

  try {
    if (!isInitialized()) {
      checks.push({
        id: 'vault', title: 'Vault entry', status: 'missing', blocking: true,
        detail: 'vault is not initialised on this host',
        fix: { runner: 'operator-root', command: 'sudo fleet secrets init' },
      });
    } else if (!loadManifest().apps[app.name]) {
      checks.push({
        id: 'vault', title: 'Vault entry', status: 'missing', blocking: true,
        detail: `no vault entry for ${app.name} — the docker build gets no env (needs ${needed.join(', ')})`,
        fix: seedKeyFix(app.name, needed[0]),
      });
      for (const key of needed) {
        checks.push({
          id: `vault-key:${key}`, title: `Vault key ${key}`, status: 'missing', blocking: true,
          detail: `${key} is required by the compose file but not in the vault`,
          fix: seedKeyFix(app.name, key),
        });
      }
    } else {
      checks.push({ id: 'vault', title: 'Vault entry', status: 'ok', detail: `vault entry exists for ${app.name}` });
      const names = vaultKeyNames(app.name);
      if (names === null) {
        checks.push({
          id: 'vault-keys', title: 'Vault key coverage', status: 'warn',
          detail: 'could not enumerate vault key names (names only are ever read) — coverage not verified',
        });
      } else {
        const missing = needed.filter(k => !names.includes(k));
        if (missing.length === 0) {
          checks.push({
            id: 'vault-keys', title: 'Vault key coverage', status: 'ok',
            detail: `all ${needed.length} compose-required key name(s) present`,
          });
        }
        for (const key of missing) {
          checks.push({
            id: `vault-key:${key}`, title: `Vault key ${key}`, status: 'missing', blocking: true,
            detail: `${key} is required by the compose file but not in the vault`,
            fix: seedKeyFix(app.name, key),
          });
        }
      }
    }
  } catch (err) {
    checks.push({
      id: 'vault', title: 'Vault entry', status: 'warn',
      detail: `could not inspect the vault: ${err instanceof Error ? err.message : String(err)}`,
    });
  }

  const runtimeEnv = join(RUNTIME_DIR, app.name, '.env');
  checks.push(existsSync(runtimeEnv)
    ? { id: 'runtime-env', title: 'Runtime env file', status: 'ok', detail: runtimeEnv }
    : {
        id: 'runtime-env', title: 'Runtime env file', status: 'missing', blocking: true,
        detail: `${runtimeEnv} does not exist — a seeded vault still needs unsealing to materialise it. ` +
          `run fleet_secrets_drift first to check for unsaved runtime changes. cli: sudo fleet secrets unseal`,
        fix: UNSEAL_FIX,
      });
}

function nginxChecks(app: AppEntry, checks: OnboardingCheck[]): void {
  if (app.domains.length === 0) {
    checks.push({ id: 'nginx', title: 'Nginx configs', status: 'skip', detail: 'no domains registered' });
    return;
  }
  let sites: ReturnType<typeof listSites> = [];
  try {
    sites = listSites();
  } catch { /* treated as no sites below */ }
  for (const domain of app.domains) {
    const site = sites.find(s => s.domain === domain);
    if (!site) {
      checks.push({
        id: `nginx:${domain}`, title: `Nginx ${domain}`, status: 'missing',
        detail: `no nginx config for ${domain}`,
        fix: { runner: 'mcp', command: `fleet_nginx_add { domain: "${domain}", port: ${app.port ?? '<port>'} }` },
      });
    } else if (!site.enabled) {
      checks.push({
        id: `nginx:${domain}`, title: `Nginx ${domain}`, status: 'warn',
        detail: 'config exists but is not enabled',
        fix: { runner: 'operator-root', command: `sudo ln -s /etc/nginx/sites-available/${domain}.conf /etc/nginx/sites-enabled/ && sudo nginx -t && sudo systemctl reload nginx` },
      });
    } else {
      checks.push({ id: `nginx:${domain}`, title: `Nginx ${domain}`, status: 'ok', detail: `config exists and is enabled${site.ssl ? ' (ssl)' : ''}` });
    }
  }
}

// informational: does the app's port answer locally? never blocking — a fresh
// registration has nothing running yet, and that is expected.
function portCheck(app: AppEntry, checks: OnboardingCheck[]): void {
  if (app.port === null) {
    checks.push({ id: 'port', title: 'Port answering', status: 'skip', detail: 'no port registered' });
    return;
  }
  const r = execSafe('curl', [
    '-s', '-o', '/dev/null', '-w', '%{http_code}',
    '--max-time', '3', `http://127.0.0.1:${app.port}/`,
  ], { timeout: 5_000 });
  const status = parseInt(r.stdout, 10);
  checks.push(!isNaN(status) && status > 0
    ? { id: 'port', title: 'Port answering', status: 'ok', detail: `127.0.0.1:${app.port} answers (http ${status})` }
    : { id: 'port', title: 'Port answering', status: 'warn', detail: `127.0.0.1:${app.port} does not answer — expected before the first deploy` });
}

export async function checkApp(appName: string): Promise<OnboardingReport> {
  const checks: OnboardingCheck[] = [];
  const reg = load();
  const app = findApp(reg, appName);

  if (!app) {
    checks.push({
      id: 'registry', title: 'Registry entry', status: 'missing', blocking: true,
      detail: `no registered app named '${appName}'`,
      fix: { runner: 'mcp', command: `fleet_register { name: "${appName}", composePath: "<dir>" }` },
    });
    return toReport(appName, checks);
  }

  checks.push({
    id: 'registry', title: 'Registry entry', status: 'ok',
    detail: `registered as ${app.name} (service ${app.serviceName}, compose ${app.composePath}${app.composeFile ? '/' + app.composeFile : ''})`,
  });

  const composeFilePath = resolveComposeFile(app);
  if (!existsSync(app.composePath) || !existsSync(composeFilePath)) {
    checks.push({
      id: 'compose', title: 'Compose file', status: 'missing', blocking: true,
      detail: `${composeFilePath} not found on disk`,
      fix: { runner: 'operator-root', command: 'fix composePath/composeFile in the registry (fleet_register with the corrected fields)' },
    });
    return toReport(app.name, checks);
  }
  checks.push({ id: 'compose', title: 'Compose file', status: 'ok', detail: composeFilePath });

  let analysis: ComposeAnalysis | null = null;
  try {
    analysis = analyzeCompose(readFileSync(composeFilePath, 'utf-8'));
  } catch {
    checks.push({
      id: 'compose-env', title: 'Compose env vars', status: 'warn',
      detail: 'could not read the compose file — env var checks skipped',
    });
  }
  if (analysis) composeChecks(app, reg, analysis, checks);

  unitChecks(app, checks);

  const needed = analysis
    ? [...new Set([...analysis.requiredVars, ...analysis.buildArgVars])].sort()
    : [];
  vaultChecks(app, needed, checks);

  nginxChecks(app, checks);
  portCheck(app, checks);

  return toReport(app.name, checks);
}

/** compact human/agent-readable lines for every check that still needs
 *  attention — used to append next steps to register output. */
export function summarizeUnresolved(rep: OnboardingReport): string[] {
  return rep.checks
    .filter(ch => ch.status === 'missing' || ch.status === 'warn')
    .map(ch => `[${ch.status}] ${ch.title}: ${ch.detail}${ch.fix ? ` -> ${ch.fix.runner}: ${ch.fix.command}` : ''}`);
}

