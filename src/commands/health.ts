import { load, findApp } from '../core/registry.js';
import { checkHealth, checkAllHealth } from '../core/health.js';
import { AppNotFoundError } from '../core/errors.js';
import { c, icon, heading, table } from '../ui/output.js';

export function healthCommand(args: string[]): void {
  const json = args.includes('--json');
  const appName = args.find(a => !a.startsWith('-'));
  const reg = load();

  if (appName) {
    const app = findApp(reg, appName);
    if (!app) throw new AppNotFoundError(appName);
    const result = checkHealth(app);

    if (json) {
      process.stdout.write(JSON.stringify(result, null, 2) + '\n');
      return;
    }

    heading(`Health: ${app.name}`);
    const sIcon = result.systemd.ok ? icon.ok : icon.err;
    process.stdout.write(`  Systemd:    ${sIcon} ${result.systemd.state}\n`);

    for (const ct of result.containers) {
      const cIcon = ct.running ? icon.ok : icon.err;
      process.stdout.write(`  Container:  ${cIcon} ${ct.name} (${ct.health})\n`);
    }

    if (result.http) {
      const hIcon = result.http.ok ? icon.ok : icon.err;
      const detail = result.http.ok ? `${result.http.status}` : (result.http.error ?? 'failed');
      process.stdout.write(`  HTTP:       ${hIcon} ${detail}\n`);
    }

    const oColor = result.overall === 'healthy' ? c.green
      : result.overall === 'degraded' ? c.yellow : c.red;
    process.stdout.write(`  Overall:    ${oColor}${result.overall}${c.reset}\n\n`);
    return;
  }

  const results = checkAllHealth(reg.apps);

  if (json) {
    process.stdout.write(JSON.stringify(results, null, 2) + '\n');
    return;
  }

  heading('Health Check');

  const rows = results.map(r => {
    const oIcon = r.overall === 'healthy' ? icon.ok
      : r.overall === 'degraded' ? icon.warn : icon.err;
    const sIcon = r.systemd.ok ? icon.ok : icon.err;
    const cOk = r.containers.filter(ct => ct.running).length;
    const cTotal = r.containers.length;
    const httpStatus = r.http
      ? (r.http.ok ? `${icon.ok} ${r.http.status}` : `${icon.err} fail`)
      : `${c.dim}-${c.reset}`;

    return [
      `${c.bold}${r.app}${c.reset}`,
      `${sIcon} ${r.systemd.state}`,
      `${cOk}/${cTotal}`,
      httpStatus,
      `${oIcon} ${r.overall}`,
    ];
  });

  table(['APP', 'SYSTEMD', 'CONTAINERS', 'HTTP', 'OVERALL'], rows);
  process.stdout.write('\n');
}
