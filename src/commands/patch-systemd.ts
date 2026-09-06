import { copyFileSync, existsSync, renameSync, writeFileSync } from 'node:fs';

import { z } from 'zod';

import { load } from '../core/registry';
import { readServiceFile, unsealUnitExists, UNSEAL_SERVICE } from '../core/systemd';
import {
  addUnitDependency,
  addUnsealDependency,
  ensureStartLimitInUnit,
  hasTeardownExecStartPre,
  removeTeardownExecStartPre,
  startLimitNeedsFix,
} from '../templates/app-unit-edit';
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

  // dedupe by service name with infra (rewriteExecStart=false) winning. a stale
  // registry can list docker-databases under both reg.apps and infrastructure;
  // without this guard the apps entry would rewrite ExecStart on the shared
  // databases service, defeating the safety carve-out.
  const targetMap = new Map<string, { name: string; rewriteExecStart: boolean; needsDb: boolean }>();
  for (const app of reg.apps) {
    targetMap.set(app.serviceName, {
      name: app.serviceName,
      rewriteExecStart: true,
      needsDb: app.dependsOnDatabases,
    });
  }
  targetMap.set(dbServiceName, { name: dbServiceName, rewriteExecStart: false, needsDb: false });
  const targets = Array.from(targetMap.values());
  const unsealInstalled = unsealUnitExists();
  // same guard as the unseal edge: systemd refuses to start a unit whose
  // Requires= target does not exist, so a registry flag alone is not enough.
  const dbUnitInstalled = readServiceFile(dbServiceName) !== null;

  ctx.log({ level: 'info', message: `patching ${targets.length} service(s)...` });
  let patched = 0;
  let skipped = 0;

  for (const { name, rewriteExecStart, needsDb } of targets) {
    const path = `${SERVICE_DIR}/${name}.service`;
    const content = readServiceFile(name);

    if (content === null) {
      ctx.log({ level: 'warn', message: `${name}: no service file found, skipping` });
      skipped++;
      continue;
    }

    let updated = content;
    let changed = false;

    // the start rate limit belongs in [Unit]. earlier versions of this command
    // wrote it into [Service], where StartLimitIntervalSec is not read, so every
    // unit silently kept the 10s default window. applies to ALL services.
    if (startLimitNeedsFix(updated)) {
      updated = ensureStartLimitInUnit(updated);
      changed = true;
    }

    // the generated units ran "docker compose down" before every start. at boot
    // that destroys the container dockerd has already restarted from its own
    // restart policy, so a start that then fails leaves the app with no
    // container at all. applies to ALL services.
    if (hasTeardownExecStartPre(updated)) {
      updated = removeTeardownExecStartPre(updated);
      changed = true;
    }

    // the runtime secrets dir is a tmpfs and is empty after every reboot.
    // fleet-unseal refills it, but that is only an ordering edge, so an app
    // still starts when the unseal fails and compose then has no env file.
    if (unsealInstalled && name !== UNSEAL_SERVICE) {
      const withUnseal = addUnsealDependency(updated);
      if (withUnseal !== updated) {
        updated = withUnseal;
        changed = true;
      }
    }

    // the registry says this app needs the shared databases, so the unit must
    // wait for them. a missing edge here is a boot race, not a cosmetic gap.
    if (needsDb && dbUnitInstalled && name !== dbServiceName) {
      const withDb = addUnitDependency(updated, `${dbServiceName}.service`);
      if (withDb !== updated) {
        updated = withDb;
        changed = true;
      }
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

    // back up the original before overwriting. write-once: a second patch run
    // must not overwrite the .bak with an already-patched file, or rollback
    // would restore a patched unit instead of the original.
    try {
      if (!existsSync(`${path}.bak`)) copyFileSync(path, `${path}.bak`);
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
  summary: 'Bring all service files up to the current unit template',
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
