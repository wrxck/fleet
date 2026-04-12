import { readFileSync } from 'node:fs';

import { load } from '../core/registry.js';
import { checkAllHealth } from '../core/health.js';
import { getServiceStatus } from '../core/systemd.js';
import { loadNotifyConfig, sendNotification } from '../core/notify.js';
import { error, success, warn } from '../ui/output.js';

function getHostname(): string {
  try {
    return readFileSync('/etc/hostname', 'utf-8').trim();
  } catch {
    return 'unknown';
  }
}

export async function watchdogCommand(args: string[]): Promise<void> {
  const isMotd = args.includes('--motd');
  const failures: string[] = [];
  const hostname = getHostname();

  // check docker-databases systemd status
  const dbStatus = getServiceStatus('docker-databases');
  if (!dbStatus.active) {
    failures.push(`docker-databases: systemd ${dbStatus.state}`);
  }

  // check all registered apps
  const reg = load();
  const results = checkAllHealth(reg.apps);

  for (const r of results) {
    if (r.overall === 'down') {
      failures.push(`${r.app}: down (systemd: ${r.systemd.state})`);
    } else if (r.overall === 'degraded') {
      const reasons: string[] = [];
      if (!r.systemd.ok) reasons.push(`systemd: ${r.systemd.state}`);
      const deadContainers = r.containers.filter(c => !c.running).map(c => c.name);
      if (deadContainers.length > 0) reasons.push(`containers down: ${deadContainers.join(', ')}`);
      if (r.http && !r.http.ok) reasons.push('http check failed');
      failures.push(`${r.app}: degraded (${reasons.join('; ')})`);
    }
  }

  if (failures.length === 0) {
    success(`All ${results.length + 1} services healthy`);
    return;
  }

  const summary = `${failures.length} service(s) unhealthy`;
  warn(summary);
  for (const f of failures) {
    error(`  ${f}`);
  }

  // MOTD mode: display only, no alerts, always exit 0
  if (isMotd) return;

  // send alert via notify adapters
  const config = loadNotifyConfig();
  if (!config) {
    warn('No notify config at /etc/fleet/notify.json — alert not sent');
    process.exit(1);
  }

  const message = [
    `fleet watchdog alert`,
    `host: ${hostname}`,
    `failures: ${failures.length}`,
    '',
    ...failures.map(f => `- ${f}`),
  ].join('\n');

  const sent = await sendNotification(config, message);
  if (sent) {
    success('Alert sent');
  } else {
    error('Failed to send alert');
  }

  process.exit(1);
}
