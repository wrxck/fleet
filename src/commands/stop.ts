import { z } from 'zod';

import { load, findApp } from '../core/registry';
import { stopService } from '../core/systemd';
import { defineCommand } from '../registry/registry';
import type { CommandResult } from '../registry/types';

export const stopCommand = defineCommand({
  name: 'stop',
  summary: 'Stop an app via systemctl',
  args: z.object({ app: z.string() }),
  async run(args): Promise<CommandResult<{ app: string; service: string }>> {
    const app = findApp(load(), args.app);
    if (!app) {
      return { ok: false, summary: `app not found: ${args.app}`, data: { app: args.app, service: '' } };
    }
    if (!stopService(app.serviceName)) {
      return { ok: false, summary: `failed to stop ${app.name}`, data: { app: app.name, service: app.serviceName } };
    }
    return { ok: true, summary: `stopped ${app.name}`, data: { app: app.name, service: app.serviceName } };
  },
});
