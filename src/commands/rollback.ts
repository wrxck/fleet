import { z } from 'zod';

import { load, findApp } from '../core/registry';
import { execSafe } from '../core/exec';
import { restartService } from '../core/systemd';
import { defineCommand } from '../registry/registry';
import type { CommandResult } from '../registry/types';

function resolveImageName(composePath: string, composeFile: string | null): string | null {
  const args = ['compose', ...(composeFile ? ['-f', composeFile] : []), 'config', '--images'];
  const r = execSafe('docker', args, { cwd: composePath, timeout: 15_000 });
  if (!r.ok) return null;
  return r.stdout.split('\n').filter(Boolean)[0] ?? null;
}

function splitImageBase(image: string): string {
  const lastColon = image.lastIndexOf(':');
  if (lastColon <= 0) return image;
  return image.slice(0, lastColon);
}

export const rollbackCommand = defineCommand({
  name: 'rollback',
  summary: 'Roll back app to previous image',
  args: z.object({ app: z.string(), yes: z.boolean().default(false) }),
  destructive: true,
  async run(args, ctx): Promise<CommandResult<{ app: string; image: string }>> {
    const app = findApp(load(), args.app);
    if (!app) {
      return { ok: false, summary: `app not found: ${args.app}`, data: { app: args.app, image: '' } };
    }
    const image = resolveImageName(app.composePath, app.composeFile);
    if (!image) {
      return { ok: false, summary: `could not resolve image name for ${app.name}`, data: { app: app.name, image: '' } };
    }
    const previous = `${splitImageBase(image)}:fleet-previous`;
    if (!execSafe('docker', ['image', 'inspect', previous], { timeout: 10_000 }).ok) {
      return { ok: false, summary: `no previous image found (${previous}) — nothing to roll back to`, data: { app: app.name, image: '' } };
    }
    if (!(args.yes || (await ctx.confirm(`Roll back ${app.name} to ${previous} and restart?`)))) {
      return { ok: false, summary: 'cancelled', data: { app: app.name, image: previous } };
    }
    const tag = execSafe('docker', ['tag', previous, image], { timeout: 10_000 });
    if (!tag.ok) {
      return { ok: false, summary: `docker tag failed: ${tag.stderr || `exit ${tag.exitCode}`}`, data: { app: app.name, image: previous } };
    }
    if (!restartService(app.serviceName)) {
      return { ok: false, summary: `tag restored but service restart failed for ${app.serviceName}`, data: { app: app.name, image: previous } };
    }
    return { ok: true, summary: `rolled back ${app.name} to ${previous}`, data: { app: app.name, image: previous } };
  },
});
