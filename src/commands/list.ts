import { load } from '../core/registry.js';
import { c, heading, table } from '../ui/output.js';

export function listCommand(args: string[]): void {
  const json = args.includes('--json');
  const reg = load();

  if (json) {
    process.stdout.write(JSON.stringify(reg.apps, null, 2) + '\n');
    return;
  }

  heading(`Registered Apps (${reg.apps.length})`);

  const rows = reg.apps.map(app => [
    `${c.bold}${app.name}${c.reset}`,
    app.serviceName,
    app.port?.toString() ?? '-',
    app.type,
    app.domains.join(', ') || '-',
  ]);

  table(['NAME', 'SERVICE', 'PORT', 'TYPE', 'DOMAINS'], rows);
  process.stdout.write('\n');
}
