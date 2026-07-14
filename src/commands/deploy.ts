import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import { load, save, findApp } from '../core/registry';
import { composeBuild, composeUp, composeDown } from '../core/docker';
import { startService, restartService, getServiceStatus } from '../core/systemd';
import { FleetError } from '../core/errors';
import { success, error, info, warn, heading } from '../ui/output';
import { addCommand } from './add';
import { makeCliContext } from '../registry/context';
import { execGit } from '../core/exec';
import { getProjectRoot } from '../core/git';
import { recordBuiltCommit } from '../core/boot-refresh';

export async function deployCommand(args: string[]): Promise<void> {
  const dryRun = args.includes('--dry-run');
  const yes = args.includes('-y') || args.includes('--yes');
  const target = args.find(a => !a.startsWith('-'));

  if (!target) {
    error('Usage: fleet deploy <app|dir>');
    process.exit(1);
  }

  heading('Deploy Pipeline');

  let reg = load();
  const fullPath = resolve(target);
  const isPath = existsSync(fullPath);
  // an exact registry name always wins, even when the argument also happens to
  // resolve to a directory relative to the cwd — otherwise running
  // `fleet deploy <name>` from the checkout's parent dir silently switches to
  // path resolution and can pick a different app registered on the same
  // directory. path resolution is the fallback for directory deploys, and
  // refuses to guess when several apps share the path.
  let app = findApp(reg, target);
  if (!app && isPath) {
    const sharing = reg.apps.filter(a => a.composePath.startsWith(fullPath));
    if (sharing.length > 1) {
      throw new FleetError(
        `Multiple apps are registered under ${fullPath}: ` +
          `${sharing.map(a => a.name).join(', ')}. Deploy one by name instead ` +
          `(see 'fleet list').`
      );
    }
    app = sharing[0];
  }

  if (!app) {
    if (!isPath) {
      throw new FleetError(
        `No registered app named '${target}', and it is not a directory. ` +
          `Pass an app name (see 'fleet list') or a path to an app directory.`
      );
    }
    info('App not registered, running add first...');
    await addCommand.run({ dir: fullPath, 'dry-run': dryRun, yes }, makeCliContext());
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
    const head = execGit(['rev-parse', 'HEAD'], { cwd: root, timeout: 10_000 });
    if (head.ok && head.stdout.trim()) {
      await recordBuiltCommit(app.name, head.stdout.trim());
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
