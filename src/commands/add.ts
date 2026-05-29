import { existsSync } from 'node:fs';
import { resolve, basename } from 'node:path';

import { z } from 'zod';

import { addApp, withRegistry } from '../core/registry';
import { getContainersByCompose } from '../core/docker';
import { installServiceFile, readServiceFile, enableService } from '../core/systemd';
import { generateServiceFile } from '../templates/systemd';
import { assertComposeFile } from '../core/validate';
import { defineCommand } from '../registry/registry';
import type { AppEntry } from '../core/registry';
import type { CommandResult } from '../registry/types';

export const addCommand = defineCommand({
  name: 'add',
  summary: 'Register an existing app',
  args: z.object({
    dir: z.string(),
    'dry-run': z.boolean().default(false),
    yes: z.boolean().default(false),
  }),
  async run(args, ctx): Promise<CommandResult<AppEntry | null>> {
    const fullPath = resolve(args.dir);

    if (!existsSync(fullPath)) {
      return { ok: false, summary: `directory not found: ${fullPath}`, data: null };
    }

    const composePath = findComposePath(fullPath);
    if (!composePath.path) {
      return { ok: false, summary: `no docker-compose.yml found in ${fullPath} or ${fullPath}/server`, data: null };
    }

    const name = basename(fullPath).toLowerCase().replace(/[^a-z0-9-]/g, '-');
    const hasService = readServiceFile(name) !== null;

    ctx.log({ level: 'info', message: `registering ${name} from ${fullPath}` });

    const containers = getContainersByCompose(composePath.path, composePath.file);
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

    const dryRun = args['dry-run'];

    if (!hasService && !dryRun && (args.yes || (await ctx.confirm('Create systemd service file?')))) {
      // defence-in-depth: validate the compose filename before interpolating
      // it into the generated systemd unit.
      if (composePath.file) assertComposeFile(composePath.file);
      const content = generateServiceFile({
        serviceName: name,
        description: `${name} Docker Service`,
        workingDirectory: composePath.path,
        composeFile: composePath.file,
        dependsOnDatabases: false,
      });
      installServiceFile(name, content);
      enableService(name);
      ctx.log({ level: 'info', message: `created and enabled ${name}.service` });
    }

    if (dryRun) {
      return {
        ok: true,
        summary: `dry run — ${name} not registered`,
        data: app,
        render: {
          kind: 'keyValue',
          pairs: [
            ['name', app.name],
            ['composePath', app.composePath],
            ['composeFile', app.composeFile ?? '(default)'],
            ['containers', app.containers.join(', ')],
          ],
        },
      };
    }

    await withRegistry(reg => addApp(reg, app));
    return { ok: true, summary: `registered ${name}`, data: app };
  },
});

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
