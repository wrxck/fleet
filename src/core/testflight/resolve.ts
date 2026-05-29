import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { load, findApp } from '../registry';
import { FleetError } from '../errors';

const SECRETS_BASE = '/run/fleet-secrets';

export interface TestflightTarget {
  app: string;
  projectPath: string;
}

// resolve a registered fleet app to its mobile project directory. testflight
// targets must be registered apps — the credentials live in the app's vault.
export function resolveTestflightTarget(target: string): TestflightTarget {
  const app = findApp(load(), target);
  if (!app) {
    throw new FleetError(`Unknown app "${target}" — not in the fleet registry.`);
  }
  const mobileDir = join(app.composePath, 'mobile');
  return {
    app: app.name,
    projectPath: existsSync(mobileDir) ? mobileDir : app.composePath,
  };
}

// minimal .env reader for an app's unsealed fleet secrets.
function readEnvFile(path: string): Record<string, string> {
  if (!existsSync(path)) return {};
  const vars: Record<string, string> = {};
  for (const line of readFileSync(path, 'utf-8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq < 1) continue;
    let val = trimmed.slice(eq + 1);
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    vars[trimmed.slice(0, eq)] = val;
  }
  return vars;
}

// an app's unsealed fleet secrets layered over the current process env. the
// vault holds the App Store Connect / Expo credentials testflight needs.
export function appSecretsEnv(app: string): NodeJS.ProcessEnv {
  return { ...process.env, ...readEnvFile(join(SECRETS_BASE, app, '.env')) };
}
