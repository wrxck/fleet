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
    // systemctl runs outside the registry lock so we don't hold it while
    // services stop/disable.
    stopService(app.serviceName);
    disableService(app.serviceName);
    try {
      await withRegistry(reg => {
        const fresh = findApp(reg, app.name);
        if (!fresh) throw new AppNotFoundError(app.name);
        return removeApp(reg, fresh.name);
      });
    } catch (err) {
      // a concurrent process removed the app between the unlocked preview and
      // the locked mutation — surface it as a graceful expected failure.
      return { ok: false, summary: err instanceof Error ? err.message : String(err), data: { app: app.name } };
    }
    ctx.log({ level: 'warn', message: 'service file not deleted — remove manually if needed' });
    return { ok: true, summary: `removed ${app.name} from registry`, data: { app: app.name } };
  },
});
