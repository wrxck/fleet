import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { AppEntry } from './registry';
import { readServiceFile } from './systemd';
import { isInitialized, loadManifest, RUNTIME_DIR } from './secrets';
import { analyzeCompose, resolveComposeFile, deployBlockingVars } from './compose-analysis';
import { seedKeyFix, UNIT_FIX, UNSEAL_FIX, type OnboardingCheck } from './onboarding';

export interface PreflightResult {
  ok: boolean;
  failures: OnboardingCheck[];
}

/**
 * The blocking subset of the onboarding checks, run before composeBuild.
 * Deliberately conservative — it blocks only on certain-failure conditions:
 *   - the systemd unit is missing (start would fail with "Unit not found");
 *   - the compose file needs env vars the environment cannot supply
 *     (strict ${VAR:?} interpolations or docker build args) and the vault
 *     entry / runtime env file that would supply them does not exist.
 * Anything this cannot determine (unreadable vault, missing compose file —
 * the build itself reports that better) is skipped, never blocked on. An app
 * whose compose requires nothing deploys exactly as before.
 */
export function preflightDeploy(app: AppEntry): PreflightResult {
  const failures: OnboardingCheck[] = [];

  try {
    if (readServiceFile(app.serviceName) === null) {
      failures.push({
        id: 'unit', title: 'Systemd unit', status: 'missing', blocking: true,
        detail: `${app.serviceName}.service does not exist — the service start after the build would fail. ` +
          `cli: sudo fleet service install ${app.name}`,
        fix: UNIT_FIX(app.name),
      });
    }
  } catch { /* cannot inspect units — do not block */ }

  let vars: string[] = [];
  try {
    const composeFilePath = resolveComposeFile(app);
    if (existsSync(composeFilePath)) {
      vars = deployBlockingVars(analyzeCompose(readFileSync(composeFilePath, 'utf-8')));
    }
  } catch { /* cannot analyse compose — do not block */ }

  if (vars.length > 0) {
    try {
      if (!isInitialized() || !loadManifest().apps[app.name]) {
        failures.push({
          id: 'vault', title: 'Vault entry', status: 'missing', blocking: true,
          detail: `the compose file needs ${vars.join(', ')} but ${app.name} has no vault entry — ` +
            'the docker build would run with empty build args (or fail interpolation). seed each key, then unseal',
          fix: seedKeyFix(app.name, vars[0]),
        });
      }
    } catch { /* cannot read the vault — do not block */ }

    try {
      const runtimeEnv = join(RUNTIME_DIR, app.name, '.env');
      if (!existsSync(runtimeEnv)) {
        failures.push({
          id: 'runtime-env', title: 'Runtime env file', status: 'missing', blocking: true,
          detail: `${runtimeEnv} does not exist, so the build gets none of ${vars.join(', ')} — ` +
            'the vault must be unsealed to materialise it. run fleet_secrets_drift first to check for ' +
            'unsaved runtime changes. cli: sudo fleet secrets unseal',
          fix: UNSEAL_FIX,
        });
      }
    } catch { /* cannot stat runtime — do not block */ }
  }

  return { ok: failures.length === 0, failures };
}

/** one line per preflight failure, fix command included — deploy error output. */
export function formatPreflightFailures(pre: PreflightResult): string[] {
  return pre.failures.map(f =>
    `  [${f.id}] ${f.detail}${f.fix ? `\n    fix (${f.fix.runner}): ${f.fix.command}` : ''}`);
}
