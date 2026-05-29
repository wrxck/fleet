import { z } from 'zod';

import { load, findApp } from '../core/registry';
import { restartService } from '../core/systemd';
import { defineCommand } from '../registry/registry';
import type { CommandResult } from '../registry/types';

export const restartCommand = defineCommand({
  name: 'restart',
  summary: 'Restart an app via systemctl',
  args: z.object({ app: z.string() }),
  async run(args): Promise<CommandResult<{ app: string; service: string }>> {
    const app = findApp(load(), args.app);
    if (!app) {
      return { ok: false, summary: `app not found: ${args.app}`, data: { app: args.app, service: '' } };
    }
    if (!restartService(app.serviceName)) {
      return { ok: false, summary: `failed to restart ${app.name}`, data: { app: app.name, service: app.serviceName } };
    }
    return { ok: true, summary: `restarted ${app.name}`, data: { app: app.name, service: app.serviceName } };
  },
});
