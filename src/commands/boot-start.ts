import { z } from 'zod';

import { load, findApp } from '../core/registry';
import { refresh } from '../core/boot-refresh';
import { composeUp } from '../core/docker';
import { defineCommand } from '../registry/registry';
import type { CommandResult } from '../registry/types';

export const bootStartCommand = defineCommand({
  name: 'boot-start',
  summary: 'Start an app respecting boot-order dependencies',
  args: z.object({ app: z.string() }),
  cliOnly: true,
  async run(args, ctx): Promise<CommandResult<{ app: string }>> {
    const app = findApp(load(), args.app);
    if (!app) {
      return { ok: false, summary: `app not found: ${args.app}`, data: { app: args.app } };
    }

    // refresh is best-effort — any error (sync or async) is logged and compose
    // up always runs. this is the fail-safe contract for boot.
    try {
      const result = await refresh(app);
      switch (result.kind) {
        case 'refreshed':
          ctx.log({ level: 'info', message: `refreshed ${app.name} head=${result.head} built=${result.built}` });
          break;
        case 'no-change':
          ctx.log({ level: 'info', message: `no-change ${app.name} head=${result.head}` });
          break;
        case 'skipped':
          ctx.log({ level: 'info', message: `skipped ${app.name} reason=${result.reason}` });
          break;
        case 'failed-safe':
          ctx.log({ level: 'warn', message: `failed-safe ${app.name} step=${result.step} detail=${result.detail}` });
          break;
      }
    } catch (err) {
      ctx.log({ level: 'warn', message: `failed-safe ${app.name} step=outer-catch detail=${err instanceof Error ? err.message : String(err)}` });
    }

    if (!composeUp(app.composePath, app.composeFile)) {
      return { ok: false, summary: `compose up failed for ${app.name}`, data: { app: app.name } };
    }
    return { ok: true, summary: `up ${app.name}`, data: { app: app.name } };
  },
});
