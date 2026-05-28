import { z } from 'zod';

import { findApp, withRegistry } from '../core/registry';
import { stopService, disableService, enableService, startService } from '../core/systemd';
import { AppNotFoundError } from '../core/errors';
import { defineCommand } from '../registry/registry';
import type { CommandResult } from '../registry/types';

export async function freezeApp(appName: string, reason?: string): Promise<void> {
  await withRegistry(reg => {
    const app = findApp(reg, appName);
    if (!app) throw new AppNotFoundError(appName);
    if (app.frozenAt) {
      throw new Error(`App "${appName}" is already frozen (since ${app.frozenAt})`);
    }

    stopService(app.serviceName);
    disableService(app.serviceName);

    app.frozenAt = new Date().toISOString();
    if (reason) app.frozenReason = reason;

    return reg;
  });
}

export async function unfreezeApp(appName: string): Promise<void> {
  let serviceName: string | null = null;

  await withRegistry(reg => {
    const app = findApp(reg, appName);
    if (!app) throw new AppNotFoundError(appName);
    if (!app.frozenAt) {
      throw new Error(`App "${appName}" is not frozen`);
    }

    delete app.frozenAt;
    delete app.frozenReason;
    serviceName = app.serviceName;

    return reg;
  });

  // Service operations run AFTER the lock is released so we don't hold the
  // registry lock while systemctl is starting things up.
  if (serviceName) {
    enableService(serviceName);
    startService(serviceName);
  }
}

export const freezeCommand = defineCommand({
  name: 'freeze',
  summary: 'Freeze a crash-looping service (stop + disable)',
  args: z.object({ app: z.string(), reason: z.string().optional(), yes: z.boolean().default(false) }),
  destructive: true,
  async run(args, ctx): Promise<CommandResult<{ app: string }>> {
    if (!args.yes && !(await ctx.confirm(`Freeze ${args.app}? This stops and disables the service.`))) {
      return { ok: false, summary: 'cancelled', data: { app: args.app } };
    }
    try {
      await freezeApp(args.app, args.reason);
    } catch (err) {
      return { ok: false, summary: err instanceof Error ? err.message : String(err), data: { app: args.app } };
    }
    return {
      ok: true,
      summary: `froze ${args.app}${args.reason ? `: ${args.reason}` : ''}`,
      data: { app: args.app },
    };
  },
});

export const unfreezeCommand = defineCommand({
  name: 'unfreeze',
  summary: 'Unfreeze and restart a frozen service',
  args: z.object({ app: z.string(), yes: z.boolean().default(false) }),
  destructive: true,
  async run(args, ctx): Promise<CommandResult<{ app: string }>> {
    if (!args.yes && !(await ctx.confirm(`Unfreeze ${args.app}? This re-enables and starts the service.`))) {
      return { ok: false, summary: 'cancelled', data: { app: args.app } };
    }
    try {
      await unfreezeApp(args.app);
    } catch (err) {
      return { ok: false, summary: err instanceof Error ? err.message : String(err), data: { app: args.app } };
    }
    return { ok: true, summary: `unfroze ${args.app} — service enabled and started`, data: { app: args.app } };
  },
});
