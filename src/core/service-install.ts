import { load, findApp } from './registry';
import { readServiceFile, installServiceFile, enableService } from './systemd';
import { generateServiceFile } from '../templates/systemd';
import { assertAppName, assertComposeFile } from './validate';

export interface ServiceInstallResult {
  ok: boolean;
  message: string;
  /** the generated unit content, when a unit was written */
  unit?: string;
}

/**
 * Generate + install the systemd unit for a REGISTERED app. Template-only
 * generation from trusted registry fields (workingDirectory = composePath,
 * composeFile + dependsOnDatabases from the registry) — no caller-supplied
 * unit content ever crosses this boundary, and the composeFile is validated
 * before interpolation. Refuses to overwrite an existing unit without force.
 */
export function installServiceForApp(appName: string, opts: { force?: boolean } = {}): ServiceInstallResult {
  assertAppName(appName);
  const reg = load();
  const app = findApp(reg, appName);
  if (!app) {
    return { ok: false, message: `No registered app named '${appName}'. Register it first (fleet add <dir> or fleet_register).` };
  }

  if (app.composeFile) assertComposeFile(app.composeFile);

  if (readServiceFile(app.serviceName) !== null && !opts.force) {
    return { ok: false, message: `${app.serviceName}.service already exists — pass force to overwrite it.` };
  }

  const content = generateServiceFile({
    serviceName: app.serviceName,
    description: `${app.displayName || app.name} Docker Service`,
    workingDirectory: app.composePath,
    composeFile: app.composeFile,
    dependsOnDatabases: app.dependsOnDatabases,
  });
  installServiceFile(app.serviceName, content);
  const enabled = enableService(app.serviceName);

  return {
    ok: true,
    unit: content,
    message: `installed ${app.serviceName}.service` +
      (enabled ? ' and enabled it at boot' : ` (enable failed — run: sudo systemctl enable ${app.serviceName}.service)`),
  };
}
