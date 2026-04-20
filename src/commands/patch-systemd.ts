import { copyFileSync, existsSync, renameSync, writeFileSync } from 'node:fs';

import { load } from '../core/registry.js';
import { readServiceFile } from '../core/systemd.js';
import { execSafe } from '../core/exec.js';
import { success, warn, info, error } from '../ui/output.js';

const SERVICE_DIR = '/etc/systemd/system';

export function patchSystemdCommand(args: string[]): void {
  if (args.includes('--rollback')) return rollback();

  const reg = load();
  const dbServiceName = reg.infrastructure.databases.serviceName;
  const appServiceNames = reg.apps.map(a => a.serviceName);

  const targets: Array<{ name: string; rewriteExecStart: boolean }> = [
    ...appServiceNames.map(name => ({ name, rewriteExecStart: true })),
    { name: dbServiceName, rewriteExecStart: false },
  ];

  info(`Patching ${targets.length} service(s)...`);
  let patched = 0;
  let skipped = 0;

  for (const { name, rewriteExecStart } of targets) {
    const path = `${SERVICE_DIR}/${name}.service`;
    const content = readServiceFile(name);

    if (content === null) {
      warn(`${name}: no service file found, skipping`);
      skipped++;
      continue;
    }

    let updated = content;
    let changed = false;

    // Existing behavior: add StartLimitBurst if missing (applies to ALL services including databases)
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

      // Ensure TimeoutStartSec=900
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
      info(`${name}: already patched, skipping`);
      skipped++;
      continue;
    }

    // Backup original before overwrite
    try {
      copyFileSync(path, `${path}.bak`);
    } catch (err) {
      warn(
        `${name}: failed to create .bak (${err instanceof Error ? err.message : String(err)}); skipping for safety`,
      );
      skipped++;
      continue;
    }

    writeFileSync(path, updated);
    success(`${name}: patched`);
    patched++;
  }

  if (patched === 0) {
    info('No services needed patching');
    return;
  }

  info('Running systemctl daemon-reload...');
  const result = execSafe('systemctl', ['daemon-reload']);
  if (result.ok) {
    success(`Done — patched ${patched} service(s), skipped ${skipped}`);
  } else {
    warn(`daemon-reload failed: ${result.stderr}`);
  }
}

function rollback(): void {
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
      success(`${name}: restored from .bak`);
      restored++;
    } catch (err) {
      error(
        `${name}: failed to restore: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  if (restored === 0) {
    info('No .bak files found to restore');
    return;
  }

  info('Running systemctl daemon-reload...');
  const result = execSafe('systemctl', ['daemon-reload']);
  if (result.ok) {
    success(`Done — restored ${restored}, missing ${missing}`);
  } else {
    warn(`daemon-reload failed: ${result.stderr}`);
  }
}
