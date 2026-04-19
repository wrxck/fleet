import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import { load, save, findApp } from '../core/registry.js';
import { composeBuild, composeUp, composeDown } from '../core/docker.js';
import { startService, restartService, getServiceStatus } from '../core/systemd.js';
import { FleetError } from '../core/errors.js';
import { success, error, info, warn, heading } from '../ui/output.js';
import { addCommand } from './add.js';
import { execSafe } from '../core/exec.js';
import { getProjectRoot } from '../core/git.js';
import { recordBuiltCommit } from '../core/boot-refresh.js';

export async function deployCommand(args: string[]): Promise<void> {
  const dryRun = args.includes('--dry-run');
  const yes = args.includes('-y') || args.includes('--yes');
  const appDir = args.find(a => !a.startsWith('-'));

  if (!appDir) {
    error('Usage: fleet deploy <app-dir>');
    process.exit(1);
  }

  const fullPath = resolve(appDir);
  if (!existsSync(fullPath)) {
    throw new FleetError(`Directory not found: ${fullPath}`);
  }

  heading('Deploy Pipeline');

  let reg = load();
  let app = reg.apps.find(a => a.composePath.startsWith(fullPath));

  if (!app) {
    info('App not registered, running add first...');
    await addCommand([...args]);
    reg = load();
    app = reg.apps.find(a => a.composePath.startsWith(fullPath));
    if (!app) throw new FleetError('Failed to register app');
  }

  if (dryRun) {
    info('Would build and deploy ' + app.name);
    warn('Dry run - no changes made');
    return;
  }

  info(`Building ${app.name}...`);
  if (!composeBuild(app.composePath, app.composeFile, app.name)) {
    error('Build failed');
    process.exit(1);
  }
  success('Build complete');

  try {
    const root = getProjectRoot(app.composePath);
    const head = execSafe('git', ['rev-parse', 'HEAD'], { cwd: root, timeout: 10_000 });
    if (head.ok && head.stdout.trim()) {
      recordBuiltCommit(app.name, head.stdout.trim());
    }
  } catch {
    // Non-fatal: deploy already succeeded
  }

  info(`Starting ${app.name}...`);
  const svc = getServiceStatus(app.serviceName);
  const started = svc.active
    ? restartService(app.serviceName)
    : startService(app.serviceName);

  if (!started) {
    error('Service start failed - check logs with: fleet logs ' + app.name);
    process.exit(1);
  }

  success(`Deployed ${app.name}`);
}
