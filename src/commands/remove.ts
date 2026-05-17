import { z } from 'zod';

import { load, findApp, removeApp, withRegistry } from '../core/registry';
import { stopService, disableService } from '../core/systemd';
import { AppNotFoundError } from '../core/errors';
import { defineCommand } from '../registry/registry';
import type { CommandResult } from '../registry/types';

export const removeCommand = defineCommand({
  name: 'remove',
  summary: 'Stop, disable and deregister an app',
  args: z.object({ app: z.string(), yes: z.boolean().default(false) }),
  destructive: true,
  async run(args, ctx): Promise<CommandResult<{ app: string }>> {
    const app = findApp(load(), args.app);
    if (!app) {
      return { ok: false, summary: `app not found: ${args.app}`, data: { app: args.app } };
    }
    if (!args.yes && !(await ctx.confirm(`Remove ${app.name}? This will stop and disable the service.`))) {
      return { ok: false, summary: 'cancelled', data: { app: app.name } };
    }
    stopService(app.serviceName);
    disableService(app.serviceName);
    await withRegistry(reg => {
      const fresh = findApp(reg, app.name);
      if (!fresh) throw new AppNotFoundError(app.name);
      return removeApp(reg, fresh.name);
    });
    ctx.log({ level: 'warn', message: 'service file not deleted — remove manually if needed' });
    return { ok: true, summary: `removed ${app.name} from registry`, data: { app: app.name } };
  },
});
