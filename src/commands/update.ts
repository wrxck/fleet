import { z } from 'zod';

import { checkForUpdate, applyUpdate, resolveChannel } from '../core/self-update';
import { defineCommand } from '../registry/registry';
import type { CommandResult } from '../registry/types';

export interface UpdateData {
  channel: 'stable' | 'prerelease';
  remoteBranch: string;
  localBranch: string;
  available: boolean;
  behind: number;
  latestSubject: string;
  /** populated only when an apply actually ran. */
  pulled?: number;
  buildOk?: boolean;
  output?: string;
  error?: string;
}

/** CLI surface for self-update. equivalent to the TUI banner + U key, but
 *  driveable from a dumb terminal, a cron job, or a Claude session. */
export const updateCommand = defineCommand({
  name: 'update',
  summary: 'Check for or install a fleet update from the configured channel',
  args: z.object({
    check: z.boolean().default(false),
    channel: z.enum(['stable', 'prerelease']).optional(),
    branch: z.string().optional(),
  }),
  async run(args, _ctx): Promise<CommandResult<UpdateData>> {
    // env-var overrides apply for the lifetime of this invocation so the
    // existing resolveChannel logic stays the single source of truth. we
    // restore the prior environment afterward so an in-process MCP call
    // doesn't leak the override into subsequent commands.
    const previous = {
      channel: process.env.FLEET_UPDATE_CHANNEL,
      branch: process.env.FLEET_UPDATE_BRANCH,
    };
    if (args.channel) process.env.FLEET_UPDATE_CHANNEL = args.channel;
    if (args.branch) process.env.FLEET_UPDATE_BRANCH = args.branch;

    try {
      const info = await checkForUpdate();
      const channelInfo = resolveChannel();

      const base: UpdateData = {
        channel: info.channel,
        remoteBranch: info.remoteBranch,
        localBranch: info.branch,
        available: info.available,
        behind: info.behind,
        latestSubject: info.latestSubject,
        ...(info.error ? { error: info.error } : {}),
      };

      if (info.error) {
        return {
          ok: false,
          summary: `check failed: ${info.error}`,
          data: base,
        };
      }

      if (!info.available) {
        return {
          ok: true,
          summary: `up to date (channel=${channelInfo.channel}, branch=${channelInfo.branch})`,
          data: base,
        };
      }

      if (args.check) {
        const subject = info.latestSubject ? ` — ${info.latestSubject}` : '';
        return {
          ok: true,
          summary: `update available (channel=${channelInfo.channel}): ${info.behind} commit${info.behind === 1 ? '' : 's'} ahead${subject}`,
          data: base,
        };
      }

      const result = await applyUpdate();
      const data: UpdateData = {
        ...base,
        pulled: result.pulled,
        buildOk: result.buildOk,
        output: result.output,
      };

      if (!result.ok) {
        return {
          ok: false,
          summary: `update failed: ${result.output}`,
          data,
        };
      }
      return {
        ok: true,
        summary: result.pulled === 0
          ? 'no changes pulled; rebuild ran'
          : `updated ${result.pulled} commit${result.pulled === 1 ? '' : 's'}, rebuilt`,
        data,
      };
    } finally {
      // restore the prior env unconditionally — even if the call threw.
      if (previous.channel === undefined) delete process.env.FLEET_UPDATE_CHANNEL;
      else process.env.FLEET_UPDATE_CHANNEL = previous.channel;
      if (previous.branch === undefined) delete process.env.FLEET_UPDATE_BRANCH;
      else process.env.FLEET_UPDATE_BRANCH = previous.branch;
    }
  },
});
