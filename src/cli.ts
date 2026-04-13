import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { statusCommand } from './commands/status.js';
import { listCommand } from './commands/list.js';
import { startCommand } from './commands/start.js';
import { stopCommand } from './commands/stop.js';
import { restartCommand } from './commands/restart.js';
import { logsCommand } from './commands/logs.js';
import { healthCommand } from './commands/health.js';
import { addCommand } from './commands/add.js';
import { removeCommand } from './commands/remove.js';
import { deployCommand } from './commands/deploy.js';
import { nginxCommand } from './commands/nginx.js';
import { secretsCommand } from './commands/secrets.js';
import { gitCommand } from './commands/git.js';
import { initCommand } from './commands/init.js';
import { depsCommand } from './commands/deps.js';
import { watchdogCommand } from './commands/watchdog.js';
import { installMcpCommand } from './commands/install-mcp.js';
import { patchSystemdCommand } from './commands/patch-systemd.js';
import { freezeCommand, unfreezeCommand } from './commands/freeze.js';
import { startMcpServer } from './mcp/server.js';
import { error } from './ui/output.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf-8'));
const VERSION = pkg.version as string;

const HELP = `fleet v${VERSION} - Docker production management CLI

Usage: fleet <command> [options]

Commands:
  status              Dashboard: all apps, services, health
  list [--json]       List registered apps
  deploy <app-dir>    Full pipeline: register, build, start
  start <app>         Start app via systemctl
  stop <app>          Stop app via systemctl
  restart <app>       Restart app via systemctl
  logs <app> [-f]     Container logs (follow mode with -f)
  health [app]        Health checks (systemd + container + HTTP)
  deps [app]          Dependency health: outdated, CVEs, EOL, Docker
  deps scan           Run fresh dependency scan
  deps fix <app>      Create PR for fixable dependency updates
  deps config         Show/set configuration
  deps ignore <pkg>   Suppress a finding
  deps init           Install cron + MOTD for automated scanning
  add <app-dir>       Register existing app
  remove <app>        Stop, disable, deregister
  nginx add <domain> --port <port> [--type proxy|spa|nextjs]
  nginx remove <domain>
  nginx list
  secrets init        Initialise age vault and unseal service
  secrets list [app]  Show managed secrets (masked values)
  secrets set <app> <KEY> <VAL>  Set a secret
  secrets get <app> <KEY>        Print decrypted value
  secrets import <app> [path]    Import .env/secrets into vault
  secrets export <app>           Print full decrypted .env
  secrets seal [app]  Re-encrypt from runtime to vault
  secrets unseal      Decrypt vault to /run/fleet-secrets/
  secrets rotate      New age key, re-encrypt everything
  secrets validate [app]  Check compose secrets vs vault
  secrets drift [app]     Detect vault vs runtime differences
  secrets restore <app>   Restore vault from backup
  secrets status      Vault state and counts
  git status [app]    Git state for one/all apps
  git onboard <app>   Create GitHub repo, push, protect branches
  git onboard-all     Onboard all apps
  git branch <app> <name> [--from develop]  Create feature branch
  git commit <app> -m "msg"  Stage + commit
  git push <app>      Push current branch
  git pr create <app> --title "..."  Create PR
  git pr list <app>   List open PRs
  git release <app>   Create develop->main PR
  tui, dashboard      Interactive terminal dashboard
  init                Auto-discover all existing apps
  watchdog            Health check all services, alert on failure
  install-mcp         Install fleet as Claude Code MCP server
  mcp                 Start as MCP server
  patch-systemd       Add StartLimitBurst/StartLimitIntervalSec to all service files
  freeze <app>        Freeze a crash-looping service (stop + disable)
  unfreeze <app>      Unfreeze and restart a frozen service

Global flags:
  --json              Output as JSON
  --dry-run           Show what would happen without making changes
  -y, --yes           Skip confirmation prompts
  -v, --version       Show version
  -h, --help          Show this help
`;

export async function run(argv: string[]): Promise<void> {
  const args = argv.slice(2);
  const command = args[0];
  const rest = args.slice(1);

  if (args.includes('-v') || args.includes('--version')) {
    process.stdout.write(VERSION + '\n');
    return;
  }

  if (args.includes('-h') || args.includes('--help')) {
    process.stdout.write(HELP);
    return;
  }

  if (!command) {
    const { launchTui } = await import('./tui/app.js');
    return launchTui();
  }

  // Commands that require root privileges
  const ROOT_COMMANDS = new Set([
    'start', 'stop', 'restart', 'deploy', 'freeze', 'unfreeze',
    'nginx', 'secrets', 'patch-systemd', 'init', 'watchdog',
  ]);

  if (ROOT_COMMANDS.has(command) && process.getuid && process.getuid() !== 0) {
    error(`'fleet ${command}' requires root privileges. Run with sudo.`);
    process.exit(1);
  }

  switch (command) {
    case 'status': return statusCommand(rest);
    case 'list': return listCommand(rest);
    case 'start': return startCommand(rest);
    case 'stop': return stopCommand(rest);
    case 'restart': return restartCommand(rest);
    case 'logs': return logsCommand(rest);
    case 'health': return healthCommand(rest);
    case 'deps': return depsCommand(rest);
    case 'add': return addCommand(rest);
    case 'remove': return removeCommand(rest);
    case 'deploy': return deployCommand(rest);
    case 'nginx': return nginxCommand(rest);
    case 'secrets': return secretsCommand(rest);
    case 'git': return gitCommand(rest);
    case 'init': return initCommand(rest);
    case 'watchdog': return watchdogCommand(rest);
    case 'install-mcp': return installMcpCommand(rest);
    case 'patch-systemd': return patchSystemdCommand(rest);
    case 'freeze': return freezeCommand(rest);
    case 'unfreeze': return unfreezeCommand(rest);
    case 'mcp': return startMcpServer();
    case 'tui':
    case 'dashboard': {
      const { launchTui } = await import('./tui/app.js');
      return launchTui();
    }
    default:
      error(`Unknown command: ${command}`);
      process.stdout.write(HELP);
      process.exit(1);
  }
}
