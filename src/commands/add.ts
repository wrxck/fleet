import { existsSync } from 'node:fs';
import { resolve, basename } from 'node:path';

import { addApp, withRegistry } from '../core/registry.js';
import { getContainersByCompose } from '../core/docker.js';
import { installServiceFile, readServiceFile, enableService } from '../core/systemd.js';
import { generateServiceFile } from '../templates/systemd.js';
import { FleetError } from '../core/errors.js';
import { success, info, error, warn } from '../ui/output.js';
import { confirm } from '../ui/confirm.js';
import type { AppEntry } from '../core/registry.js';

export async function addCommand(args: string[]): Promise<void> {
  const dryRun = args.includes('--dry-run');
  const yes = args.includes('-y') || args.includes('--yes');
  const appDir = args.find(a => !a.startsWith('-'));

  if (!appDir) {
    error('Usage: fleet add <app-dir>');
    process.exit(1);
  }

  const fullPath = resolve(appDir);
  if (!existsSync(fullPath)) {
    throw new FleetError(`Directory not found: ${fullPath}`);
  }

  const composePath = findComposePath(fullPath);
  if (!composePath.path) {
    throw new FleetError(`No docker-compose.yml found in ${fullPath} or ${fullPath}/server`);
  }

  const name = basename(fullPath).toLowerCase().replace(/[^a-z0-9-]/g, '-');
  const existingService = readServiceFile(name);
  const hasService = existingService !== null;

  info(`Registering ${name} from ${fullPath}`);
  info(`Compose path: ${composePath.path}`);
  info(`Compose file: ${composePath.file ?? 'default'}`);

  const containers = getContainersByCompose(composePath.path, composePath.file);
  info(`Found containers: ${containers.join(', ') || 'none running'}`);

  const app: AppEntry = {
    name,
    displayName: name,
    composePath: composePath.path,
    composeFile: composePath.file,
    serviceName: name,
    domains: [],
    port: null,
    usesSharedDb: false,
    type: 'service',
    containers: containers.length > 0 ? containers : [name],
    dependsOnDatabases: false,
    registeredAt: new Date().toISOString(),
  };

  if (!hasService) {
    info('No systemd service file found');
    if (!dryRun && (yes || await confirm('Create systemd service file?'))) {
      const content = generateServiceFile({
        serviceName: name,
        description: `${name} Docker Service`,
        workingDirectory: composePath.path,
        composeFile: composePath.file,
        dependsOnDatabases: false,
      });
      installServiceFile(name, content);
      enableService(name);
      success(`Created and enabled ${name}.service`);
    }
  } else {
    info('Existing systemd service file found');
  }

  if (dryRun) {
    warn('Dry run - no changes saved');
    process.stdout.write(JSON.stringify(app, null, 2) + '\n');
    return;
  }

  await withRegistry(reg => addApp(reg, app));
  success(`Registered ${name}`);
}

function findComposePath(dir: string): { path: string; file: string | null } {
  if (existsSync(`${dir}/docker-compose.yml`)) {
    return { path: dir, file: null };
  }
  if (existsSync(`${dir}/docker-compose.yaml`)) {
    return { path: dir, file: null };
  }
  if (existsSync(`${dir}/server/docker-compose.yml`)) {
    return { path: `${dir}/server`, file: null };
  }
  if (existsSync(`${dir}/server/docker-compose.yaml`)) {
    return { path: `${dir}/server`, file: null };
  }

  return { path: '', file: null };
}
