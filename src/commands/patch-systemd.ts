import { copyFileSync, existsSync, renameSync, writeFileSync } from 'node:fs';

import { z } from 'zod';

import { load } from '../core/registry';
import { readServiceFile } from '../core/systemd';
import { execSafe } from '../core/exec';
import { defineCommand } from '../registry/registry';
import type { CommandContext, CommandResult } from '../registry/types';

const SERVICE_DIR = '/etc/systemd/system';

interface PatchSystemdData {
  action: 'patch' | 'rollback';
  changed: number;
  skipped: number;
}

function runPatch(ctx: CommandContext): CommandResult<PatchSystemdData> {
  const reg = load();
  const dbServiceName = reg.infrastructure.databases.serviceName;
  const appServiceNames = reg.apps.map(a => a.serviceName);

  // dedupe by service name with infra (rewriteExecStart=false) winning. a stale
  // registry can list docker-databases under both reg.apps and infrastructure;
  // without this guard the apps entry would rewrite ExecStart on the shared
  // databases service, defeating the safety carve-out.
  const targetMap = new Map<string, { name: string; rewriteExecStart: boolean }>();
  for (const name of appServiceNames) {
    targetMap.set(name, { name, rewriteExecStart: true });
  }
  targetMap.set(dbServiceName, { name: dbServiceName, rewriteExecStart: false });
  const targets = Array.from(targetMap.values());

  ctx.log({ level: 'info', message: `patching ${targets.length} service(s)...` });
  let patched = 0;
  let skipped = 0;

  for (const { name, rewriteExecStart } of targets) {
    const path = `${SERVICE_DIR}/${name}.service`;
    const content = readServiceFile(name);

    if (content === null) {
      ctx.log({ level: 'warn', message: `${name}: no service file found, skipping` });
      skipped++;
      continue;
    }

    let updated = content;
    let changed = false;

    // existing behaviour: add StartLimitBurst if missing (applies to ALL services including databases)
    if (!updated.includes('StartLimitBurst=')) {
      updated = updated.replace(
        /(\[Service\])/,
        '$1\nStartLimitBurst=5\nStartLimitIntervalSec=300',
      );
      changed = true;
    }

    // ExecStart + TimeoutStartSec rewrite ONLY for app services — databases has no git repo
    if (rewriteExecStart) {
      const expectedExecStart = `ExecStart=/usr/bin/env fleet boot-start ${name}`;
      if (!updated.includes(expectedExecStart)) {
        updated = updated.replace(/^ExecStart=.*$/m, expectedExecStart);
        changed = true;
      }

      // ensure TimeoutStartSec=900
      if (!updated.includes('TimeoutStartSec=900')) {
        if (/^TimeoutStartSec=\d+/m.test(updated)) {
          updated = updated.replace(/^TimeoutStartSec=\d+.*$/m, 'TimeoutStartSec=900');
        } else {
          updated = updated.replace(/(\[Service\])/, '$1\nTimeoutStartSec=900');
        }
        changed = true;
      }
    }

    if (!changed) {
      ctx.log({ level: 'info', message: `${name}: already patched, skipping` });
      skipped++;
      continue;
    }

    // backup original before overwrite
    try {
      copyFileSync(path, `${path}.bak`);
    } catch (err) {
      ctx.log({
        level: 'warn',
        message: `${name}: failed to create .bak (${err instanceof Error ? err.message : String(err)}); skipping for safety`,
      });
      skipped++;
      continue;
    }

    writeFileSync(path, updated);
    ctx.log({ level: 'info', message: `${name}: patched` });
    patched++;
  }

  if (patched === 0) {
    return {
      ok: true,
      summary: 'no services needed patching',
      data: { action: 'patch', changed: 0, skipped },
    };
  }

  ctx.log({ level: 'info', message: 'running systemctl daemon-reload...' });
  const result = execSafe('systemctl', ['daemon-reload']);
  if (!result.ok) {
    return {
      ok: false,
      summary: `patched ${patched} service(s) but daemon-reload failed: ${result.stderr}`,
      data: { action: 'patch', changed: patched, skipped },
    };
  }

  return {
    ok: true,
    summary: `patched ${patched} service(s), skipped ${skipped}`,
    data: { action: 'patch', changed: patched, skipped },
  };
}

function runRollback(ctx: CommandContext): CommandResult<PatchSystemdData> {
  const reg = load();
  const serviceNames = [
    ...reg.apps.map(a => a.serviceName),
    reg.infrastructure.databases.serviceName,
  ];

  let restored = 0;
  let missing = 0;

  for (const name of serviceNames) {
    const path = `${SERVICE_DIR}/${name}.service`;
    const bak = `${path}.bak`;

    if (!existsSync(bak)) {
      missing++;
      continue;
    }

    try {
      renameSync(bak, path);
      ctx.log({ level: 'info', message: `${name}: restored from .bak` });
      restored++;
    } catch (err) {
      ctx.log({
        level: 'error',
        message: `${name}: failed to restore: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  }

  if (restored === 0) {
    return {
      ok: true,
      summary: 'no .bak files found to restore',
      data: { action: 'rollback', changed: 0, skipped: missing },
    };
  }

  ctx.log({ level: 'info', message: 'running systemctl daemon-reload...' });
  const result = execSafe('systemctl', ['daemon-reload']);
  if (!result.ok) {
    return {
      ok: false,
      summary: `restored ${restored} but daemon-reload failed: ${result.stderr}`,
      data: { action: 'rollback', changed: restored, skipped: missing },
    };
  }

  return {
    ok: true,
    summary: `restored ${restored}, missing ${missing}`,
    data: { action: 'rollback', changed: restored, skipped: missing },
  };
}

export const patchSystemdCommand = defineCommand({
  name: 'patch-systemd',
  summary: 'Add StartLimit settings to all service files',
  args: z.object({ rollback: z.boolean().default(false), yes: z.boolean().default(false) }),
  destructive: true,
  async run(args, ctx): Promise<CommandResult<PatchSystemdData>> {
    const verb = args.rollback ? 'roll back' : 'patch';
    if (!args.yes && !(await ctx.confirm(`${verb} all fleet systemd unit files?`))) {
      return {
        ok: false,
        summary: 'cancelled',
        data: { action: args.rollback ? 'rollback' : 'patch', changed: 0, skipped: 0 },
      };
    }
    return args.rollback ? runRollback(ctx) : runPatch(ctx);
  },
});
