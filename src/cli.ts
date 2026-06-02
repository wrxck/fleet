import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadRegistry } from './registry/index';
import { getCommand } from './registry/registry';
import { parseArgs } from './registry/parse-args';
import { renderToText } from './registry/render';
import { makeCliContext } from './registry/context';
import { logsCommand } from './commands/logs';
import { egressCommand } from './commands/egress';
import { deployCommand } from './commands/deploy';
import { nginxCommand } from './commands/nginx';
import { secretsCommand } from './commands/secrets';
import { gitCommand } from './commands/git';
import { depsCommand } from './commands/deps';
import { auditCommand } from './commands/audit';
import { testflightCommand } from './commands/testflight';
import { watchdogCommand } from './commands/watchdog';
import { guardCommand } from './commands/guard';
import { backupCommand } from './commands/backup';
import { mockCommand } from './commands/mock';
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
  testflight publish <app>     Dispatch the macOS build workflow to TestFlight
  testflight builds <app>      List TestFlight builds
  testflight update <app> --build <id> --whats-new "..."  Set test notes
  testflight delete <app> --build <id>   Expire a TestFlight build
  testflight doctor <app>      Check gh + App Store Connect credentials
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
  mcp                 Start the stdio MCP server (runs as the calling user)
  mcp install         Install the privilege-separated root MCP daemon (root)
  mcp connect         Proxy stdio to the root daemon's socket (for MCP clients)
  mcp doctor          Check the root daemon: group, unit, socket perms, policy
  mcp uninstall       Remove the root MCP daemon and its unit (root)
  patch-systemd       Add StartLimitBurst/StartLimitIntervalSec to all service files
  boot-start <app>    Start app respecting boot-order dependencies
  freeze <app>        Freeze a crash-looping service (stop + disable)
  rollback <app>      Roll back app to previous image
  unfreeze <app>      Unfreeze and restart a frozen service
  guard <subcommand>  Cloudflare protection layer (install/status/approve/reject/...)
  backup <subcommand> Encrypted off-host backups via restic + age (init/snapshot/list/restore/...)
  mock start <name> --port <n> [--mappings <dir>]  Start a local wiremock-ts mock server (dev)
  mock list           List running mock servers
  mock stub <name> --url <path> [--method GET] [--status 200] [--json '{...}' | --body <text>]
  mock reset <name>   Clear a mock's stubs and request journal
  mock stop <name|--all>  Stop mock server(s)
  update [--check] [--channel stable|prerelease] [--branch <name>]
                      Self-update fleet (check / apply, channel selectable)
  doctor              Preflight: host requirements, registry, vault, operator config, orphans
  config [show|get|set] [<field>] [<value>]
                      Show or update the operator identity (data/operator.json)
  whoami              Print operator identity in one line
  completions <shell> Emit shell completion script (bash | zsh | fish)

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
    'testflight',
  ]);

  if (ROOT_COMMANDS.has(command) && process.getuid && process.getuid() !== 0) {
    error(`'fleet ${command}' requires root privileges. Run with sudo.`);
    process.exit(1);
  }

  if (await dispatchRegistryCommand(command, rest)) return;

  switch (command) {
    case 'logs': return logsCommand(rest);
    case 'egress': return egressCommand(rest);
    case 'deps': return depsCommand(rest);
    case 'audit': return auditCommand(rest);
    case 'testflight': return testflightCommand(rest);
    case 'deploy': return deployCommand(rest);
    case 'nginx': return nginxCommand(rest);
    case 'secrets': return secretsCommand(rest);
    case 'git': return gitCommand(rest);
    case 'watchdog': return watchdogCommand(rest);
    case 'guard': return guardCommand(rest);
    case 'backup': return backupCommand(rest);
    case 'mock': return mockCommand(rest);
    case 'mcp': {
      const mcpSub = rest[0];
      if (mcpSub === 'connect') {
        const { mcpConnect } = await import('./mcp/connect');
        return mcpConnect();
      }
      if (mcpSub === 'daemon') {
        const { startMcpDaemon } = await import('./mcp/daemon');
        await startMcpDaemon();
        return;
      }
      if (mcpSub && mcpSub !== 'serve') {
        const { mcpManageCommand } = await import('./commands/mcp');
        return mcpManageCommand(rest);
      }
      // bare `fleet mcp` (or `fleet mcp serve`): legacy stdio server, unchanged.
      return startMcpServer();
    }
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
