import * as nginxCore from '../core/nginx.js';

import { generateNginxConfig } from '../templates/nginx.js';
import { FleetError } from '../core/errors.js';
import { c, heading, table, success, error, info, warn } from '../ui/output.js';
import { confirm } from '../ui/confirm.js';

export async function nginxCommand(args: string[]): Promise<void> {
  const sub = args[0];
  const rest = args.slice(1);

  switch (sub) {
    case 'add': return nginxAdd(rest);
    case 'remove': return nginxRemove(rest);
    case 'list': return nginxList(rest);
    default:
      error('Usage: fleet nginx <add|remove|list>');
      process.exit(1);
  }
}

async function nginxAdd(args: string[]): Promise<void> {
  const dryRun = args.includes('--dry-run');
  const yes = args.includes('-y') || args.includes('--yes');
  const domain = args.find(a => !a.startsWith('-'));
  const portIdx = args.indexOf('--port');
  const port = portIdx >= 0 ? parseInt(args[portIdx + 1], 10) : null;
  const typeIdx = args.indexOf('--type');
  const type = (typeIdx >= 0 ? args[typeIdx + 1] : 'proxy') as 'proxy' | 'spa' | 'nextjs';

  if (!domain || !port) {
    error('Usage: fleet nginx add <domain> --port <port> [--type proxy|spa|nextjs]');
    process.exit(1);
  }

  const existing = nginxCore.readConfig(domain);
  if (existing) {
    throw new FleetError(`Config already exists for ${domain}`);
  }

  const config = generateNginxConfig({ domain, port, type });

  if (dryRun) {
    info('Generated config:');
    process.stdout.write(config + '\n');
    warn('Dry run - no changes made');
    return;
  }

  nginxCore.installConfig(domain, config);
  info(`Installed ${domain}.conf`);

  const test = nginxCore.testConfig();
  if (!test.ok) {
    error(`Nginx config test failed: ${test.output}`);
    nginxCore.removeConfig(domain);
    error('Config removed due to test failure');
    process.exit(1);
  }

  success('Nginx config test passed');

  if (nginxCore.reload()) {
    success(`Nginx reloaded - ${domain} is live`);
  } else {
    warn('Failed to reload nginx - reload manually');
  }

  info(`Run certbot to add SSL: certbot --nginx -d ${domain} -d www.${domain}`);
}

async function nginxRemove(args: string[]): Promise<void> {
  const yes = args.includes('-y') || args.includes('--yes');
  const domain = args.find(a => !a.startsWith('-'));

  if (!domain) {
    error('Usage: fleet nginx remove <domain>');
    process.exit(1);
  }

  if (!yes && !await confirm(`Remove nginx config for ${domain}?`)) {
    info('Cancelled');
    return;
  }

  if (nginxCore.removeConfig(domain)) {
    success(`Removed ${domain}.conf`);
    nginxCore.reload();
    success('Nginx reloaded');
  } else {
    error(`Config not found for ${domain}`);
  }
}

function nginxList(args: string[]): void {
  const json = args.includes('--json');
  const sites = nginxCore.listSites();

  if (json) {
    process.stdout.write(JSON.stringify(sites, null, 2) + '\n');
    return;
  }

  heading(`Nginx Sites (${sites.length})`);

  const rows = sites.map(s => [
    `${c.bold}${s.domain}${c.reset}`,
    s.enabled ? `${c.green}enabled${c.reset}` : `${c.dim}disabled${c.reset}`,
    s.ssl ? `${c.green}ssl${c.reset}` : `${c.dim}no ssl${c.reset}`,
  ]);

  table(['DOMAIN', 'STATUS', 'SSL'], rows);
  process.stdout.write('\n');
}
