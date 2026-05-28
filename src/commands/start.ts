import { z } from 'zod';

import { load, findApp } from '../core/registry';
import { startService } from '../core/systemd';
import { defineCommand } from '../registry/registry';
import type { CommandResult } from '../registry/types';

export const startCommand = defineCommand({
  name: 'start',
  summary: 'Start an app via systemctl',
  args: z.object({ app: z.string() }),
  async run(args): Promise<CommandResult<{ app: string; service: string }>> {
    const app = findApp(load(), args.app);
    if (!app) {
      return { ok: false, summary: `app not found: ${args.app}`, data: { app: args.app, service: '' } };
    }
    if (!startService(app.serviceName)) {
      return { ok: false, summary: `failed to start ${app.name}`, data: { app: app.name, service: app.serviceName } };
    }
    return { ok: true, summary: `started ${app.name}`, data: { app: app.name, service: app.serviceName } };
  },
});
