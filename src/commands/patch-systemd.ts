import { writeFileSync } from 'node:fs';

import { load } from '../core/registry.js';
import { readServiceFile } from '../core/systemd.js';
import { execSafe } from '../core/exec.js';
import { success, warn, info } from '../ui/output.js';

export function patchSystemdCommand(_args: string[]): void {
  const reg = load();

  const serviceNames = [
    ...reg.apps.map(a => a.serviceName),
    reg.infrastructure.databases.serviceName,
  ];

  info(`Checking ${serviceNames.length} service(s) for restart limits...`);

  let patched = 0;
  let skipped = 0;

  for (const name of serviceNames) {
    const content = readServiceFile(name);

    if (content === null) {
      warn(`${name}: no service file found, skipping`);
      skipped++;
      continue;
    }

    if (content.includes('StartLimitBurst=')) {
      info(`${name}: already has StartLimitBurst, skipping`);
      skipped++;
      continue;
    }

    const updated = content.replace(
      /(\[Service\])/,
      '$1\nStartLimitBurst=5\nStartLimitIntervalSec=300',
    );

    const path = `/etc/systemd/system/${name}.service`;
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
