import { existsSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { load, findApp } from '../registry';
import { FleetError } from '../errors';

export interface AuditTarget {
  // canonical name for the audit — the registered app name, or the path given
  target: string;
  // mobile project directory greenlight should scan
  projectPath: string;
}

// resolve an audit target to the mobile project directory to scan.
//
// a target is either an existing directory path (used as-is) or a registered
// fleet app name. for a registered app the convention is a `mobile/` subdir of
// its compose root — that is where an expo / ios project lives in a repo whose
// root holds docker-compose — falling back to the compose root when there is
// no such subdir.
export function resolveAuditTarget(target: string): AuditTarget {
  const asPath = resolve(target);
  if (existsSync(asPath) && statSync(asPath).isDirectory()) {
    return { target, projectPath: asPath };
  }

  const app = findApp(load(), target);
  if (!app) {
    throw new FleetError(
      `Audit target "${target}" is neither an existing directory nor a registered app.`,
    );
  }

  const mobileDir = join(app.composePath, 'mobile');
  return {
    target: app.name,
    projectPath: existsSync(mobileDir) ? mobileDir : app.composePath,
  };
}
