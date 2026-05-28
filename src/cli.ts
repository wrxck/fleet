import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadRegistry } from './registry/index';
import { getCommand } from './registry/registry';
import { parseArgs } from './registry/parse-args';
import { renderToText } from './registry/render';
import { makeCliContext } from './registry/context';
import { listCommand } from './commands/list';
import { startCommand } from './commands/start';
import { stopCommand } from './commands/stop';
import { restartCommand } from './commands/restart';
import { logsCommand } from './commands/logs';
import { egressCommand } from './commands/egress';
import { healthCommand } from './commands/health';
import { addCommand } from './commands/add';
import { removeCommand } from './commands/remove';
import { deployCommand } from './commands/deploy';
import { nginxCommand } from './commands/nginx';
import { secretsCommand } from './commands/secrets';
import { gitCommand } from './commands/git';
import { initCommand } from './commands/init';
import { depsCommand } from './commands/deps';
import { auditCommand } from './commands/audit';
import { watchdogCommand } from './commands/watchdog';
import { installMcpCommand } from './commands/install-mcp';
import { patchSystemdCommand } from './commands/patch-systemd';
import { freezeCommand, unfreezeCommand } from './commands/freeze';
import { guardCommand } from './commands/guard';
import { bootStartCommand } from './commands/boot-start';
import { rollbackCommand } from './commands/rollback';
import { backupCommand } from './commands/backup';
import { routineRunCommand } from './commands/routine-run';
import { routinesCommand } from './commands/routines';
import { startMcpServer } from './mcp/server';
import { error } from './ui/output';

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
  audit [target]      App Store compliance audit of a mobile project (greenlight)
  audit guidelines    Browse Apple App Store Review Guidelines (list|show|search)
  audit doctor        Check the greenlight binary is installed
  audit ignore "<title>" --reason "..."  Suppress a greenlight false positive
  audit ignores       List audit ignore rules
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
  routines            Fleet-wide routines TUI (signals grid + routine history)
  routine-run --id <id> [--target <repo>] [--trigger scheduled]
                      Headless entrypoint for systemd-timer units. JSON mode: --json.
  init                Auto-discover all existing apps
  watchdog            Health check all services, alert on failure
  install-mcp         Install fleet as Claude Code MCP server
  mcp                 Start as MCP server
  patch-systemd       Add StartLimitBurst/StartLimitIntervalSec to all service files
  boot-start <app>    Start app respecting boot-order dependencies
  freeze <app>        Freeze a crash-looping service (stop + disable)
  rollback <app>      Roll back app to previous image
  unfreeze <app>      Unfreeze and restart a frozen service
  guard <subcommand>  Cloudflare protection layer (install/status/approve/reject/...)
  backup <subcommand> Encrypted off-host backups via restic + age (init/snapshot/list/restore/...)

Global flags:
  --json              Output as JSON
  --dry-run           Show what would happen without making changes
  -y, --yes           Skip confirmation prompts
  -v, --version       Show version
  -h, --help          Show this help
`;

/**
 * resolves a command from the registry and runs it. returns true when handled,
 * false when the name is unknown (so run() falls through to the legacy switch).
 */
export async function dispatchRegistryCommand(
  command: string,
  rest: string[],
  write: (s: string) => void = s => process.stdout.write(s),
): Promise<boolean> {
  loadRegistry();
  const def = getCommand(command);
  if (!def) return false;

  // --json is an output flag for the registry dispatch path — handled here,
  // not a per-command argument, so it is stripped before the schema parse
  // would reject it as unknown. legacy (non-registry) commands that still
  // live in the switch below parse --json themselves.
  const jsonMode = rest.includes('--json');
  const cmdArgs = rest.filter(arg => arg !== '--json');

  const parsed = parseArgs(def.args, cmdArgs);
  if (parsed.help) {
    // minimal help for now — one-line summary; richer per-command help is future work.
    write(`${def.name} — ${def.summary}\n`);
    return true;
  }
  if (!parsed.ok) {
    process.stderr.write(`error: ${parsed.error}\n`);
    process.exitCode = 1;
    return true;
  }

  const result = await def.run(parsed.values, makeCliContext());
  if (jsonMode) {
    write(JSON.stringify(result.data, null, 2) + '\n');
  } else {
    if (result.render) write(renderToText(result.render) + '\n');
    write(result.summary + '\n');
  }
  if (!result.ok) process.exitCode = 1;
  return true;
}

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
    const { launchTui } = await import('./tui/app');
    return launchTui();
  }

  // commands that require root privileges
  const ROOT_COMMANDS = new Set([
    'start', 'stop', 'restart', 'deploy', 'freeze', 'unfreeze',
    'nginx', 'secrets', 'patch-systemd', 'init', 'watchdog', 'backup',
  ]);

  if (ROOT_COMMANDS.has(command) && process.getuid && process.getuid() !== 0) {
    error(`'fleet ${command}' requires root privileges. Run with sudo.`);
    process.exit(1);
  }

  if (await dispatchRegistryCommand(command, rest)) return;

  switch (command) {
    case 'list': return listCommand(rest);
    case 'start': return startCommand(rest);
    case 'stop': return stopCommand(rest);
    case 'restart': return restartCommand(rest);
    case 'logs': return logsCommand(rest);
    case 'egress': return egressCommand(rest);
    case 'health': return healthCommand(rest);
    case 'deps': return depsCommand(rest);
    case 'audit': return auditCommand(rest);
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
    case 'boot-start': return bootStartCommand(rest);
    case 'freeze': return freezeCommand(rest);
    case 'rollback': return rollbackCommand(rest);
    case 'unfreeze': return unfreezeCommand(rest);
    case 'guard': return guardCommand(rest);
    case 'backup': return backupCommand(rest);
    case 'mcp': return startMcpServer();
    case 'tui':
    case 'dashboard': {
      const { launchTui } = await import('./tui/app');
      return launchTui();
    }
    case 'routines': return routinesCommand(rest);
    case 'routine-run': return routineRunCommand(rest);
    default:
      error(`Unknown command: ${command}`);
      process.stdout.write(HELP);
      process.exit(1);
  }
}
