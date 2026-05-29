import { spawnSync } from 'node:child_process';
import {
  chmodSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync, copyFileSync,
} from 'node:fs';
import { dirname } from 'node:path';

import { error, info, success, warn, heading } from '../ui/output';
import { execSafe } from '../core/exec';
import { generateMcpService, resolveDaemonEntry, MCP_SERVICE_PATH } from '../templates/mcp-units';
import { DEFAULT_POLICY, POLICY_PATH, AUDIT_PATH } from '../mcp/guard';
import { socketPath, GUARD_GROUP } from '../mcp/socket-path';

function requireRoot(): void {
  if (process.getuid && process.getuid() !== 0) {
    throw new Error('this command needs root. try: sudo fleet mcp ' + (process.argv[3] ?? 'install'));
  }
}

function run(cmd: string, args: string[]): void {
  const r = spawnSync(cmd, args, { stdio: 'inherit' });
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(' ')} failed`);
}

function ensureGroup(): void {
  if (spawnSync('getent', ['group', GUARD_GROUP], { stdio: 'ignore' }).status === 0) return;
  run('groupadd', ['--system', GUARD_GROUP]);
  info(`created group ${GUARD_GROUP}`);
}

// add the human who invoked sudo to the guard group so they can use the proxy.
function addInvokerToGroup(): void {
  const user = process.env.SUDO_USER;
  if (!user || user === 'root') {
    warn(`run via sudo as your normal user to be added to ${GUARD_GROUP} automatically`);
    return;
  }
  run('usermod', ['-aG', GUARD_GROUP, user]);
  info(`added ${user} to ${GUARD_GROUP} (re-login required for it to take effect)`);
}

function writeDefaultPolicy(): void {
  if (existsSync(POLICY_PATH)) {
    info(`policy already present at ${POLICY_PATH} (left unchanged)`);
    return;
  }
  mkdirSync(dirname(POLICY_PATH), { recursive: true, mode: 0o710 });
  writeFileSync(POLICY_PATH, JSON.stringify(DEFAULT_POLICY, null, 2) + '\n', { mode: 0o640 });
  info(`wrote default policy to ${POLICY_PATH} (destructive tools denied)`);
}

function homeOf(user: string): string | null {
  const r = execSafe('getent', ['passwd', user]);
  if (!r.ok) return null;
  return r.stdout.split(':')[5] || null;
}

// patch the invoking user's ~/.claude.json so the fleet mcp entry dials the proxy.
// backs the file up first and only touches mcpServers.fleet.
function writeClientConfig(): void {
  const user = process.env.SUDO_USER;
  if (!user || user === 'root') { warn('no SUDO_USER — skipping client config'); return; }
  const home = homeOf(user);
  if (!home) { warn(`could not resolve home for ${user} — skipping client config`); return; }
  const cfgPath = `${home}/.claude.json`;
  if (!existsSync(cfgPath)) { warn(`${cfgPath} not found — add the mcp entry manually (see below)`); return; }

  const backup = `${cfgPath}.bak-mcp`;
  copyFileSync(cfgPath, backup);
  const data = JSON.parse(readFileSync(cfgPath, 'utf8')) as Record<string, unknown>;
  const servers = (data.mcpServers ??= {}) as Record<string, unknown>;
  servers.fleet = { command: 'fleet', args: ['mcp', 'connect'] };
  writeFileSync(cfgPath, JSON.stringify(data, null, 2) + '\n');
  // hand the file back to its owner; running as root would otherwise leave it root-owned.
  const r = execSafe('getent', ['passwd', user]);
  const uid = Number(r.stdout.split(':')[2]);
  const gid = Number(r.stdout.split(':')[3]);
  if (Number.isInteger(uid) && Number.isInteger(gid)) run('chown', [`${uid}:${gid}`, cfgPath]);
  success(`patched ${cfgPath} (backup: ${backup})`);
}

function clientSnippet(): string {
  return JSON.stringify({ mcpServers: { fleet: { command: 'fleet', args: ['mcp', 'connect'] } } }, null, 2);
}

function install(args: string[]): void {
  requireRoot();
  heading('fleet mcp install');
  ensureGroup();
  addInvokerToGroup();
  writeDefaultPolicy();
  mkdirSync(dirname(AUDIT_PATH), { recursive: true, mode: 0o750 });

  writeFileSync(MCP_SERVICE_PATH, generateMcpService());
  info(`installed ${MCP_SERVICE_PATH}`);
  const { entry, fromCheckout } = resolveDaemonEntry();
  if (fromCheckout) {
    warn(`daemon runs from a git checkout: ${entry}`);
    warn('root git activity there can leave root-owned .git objects that block your commits.');
    warn('for a standalone install: sudo npm i -g @matthesketh/fleet, then re-run: sudo fleet mcp install');
  }
  run('systemctl', ['daemon-reload']);
  run('systemctl', ['enable', '--now', 'fleet-mcp.service']);
  success('fleet-mcp.service started');

  if (args.includes('--write-client-config')) {
    writeClientConfig();
  } else {
    info('add this to your ~/.claude.json (or re-run with --write-client-config):');
    process.stdout.write(clientSnippet() + '\n');
  }

  heading('next steps');
  info('1. log out and back in so your shell picks up the ' + GUARD_GROUP + ' group');
  info('2. verify with: fleet mcp doctor');
  info('3. to allow a destructive tool, set it to "allow" in ' + POLICY_PATH);
}

function uninstall(): void {
  requireRoot();
  heading('fleet mcp uninstall');
  spawnSync('systemctl', ['disable', '--now', 'fleet-mcp.service'], { stdio: 'inherit' });
  if (existsSync(MCP_SERVICE_PATH)) { run('rm', ['-f', MCP_SERVICE_PATH]); info('removed service unit'); }
  run('systemctl', ['daemon-reload']);
  info(`left ${POLICY_PATH}, the ${GUARD_GROUP} group, and ${AUDIT_PATH} in place (remove manually if desired)`);
  success('fleet-mcp uninstalled');
}

function fmtMode(path: string): string {
  try {
    const s = statSync(path);
    return `${(s.mode & 0o777).toString(8)} (uid ${s.uid}, gid ${s.gid})`;
  } catch {
    return 'missing';
  }
}

function doctor(): void {
  heading('fleet mcp doctor');
  const path = socketPath();
  const checks: Array<[string, boolean, string]> = [];

  const grp = execSafe('getent', ['group', GUARD_GROUP]);
  checks.push([`group ${GUARD_GROUP}`, grp.ok, grp.ok ? grp.stdout.split(':')[2] : 'missing']);

  const unit = existsSync(MCP_SERVICE_PATH);
  checks.push(['service unit', unit, unit ? MCP_SERVICE_PATH : 'missing']);

  const active = execSafe('systemctl', ['is-active', 'fleet-mcp.service']);
  checks.push(['service active', active.stdout === 'active', active.stdout || active.stderr]);

  const sockOk = existsSync(path);
  checks.push(['socket', sockOk, sockOk ? fmtMode(path) : `missing (${path})`]);

  checks.push(['policy', existsSync(POLICY_PATH), existsSync(POLICY_PATH) ? POLICY_PATH : 'using built-in defaults']);

  const { entry, fromCheckout } = resolveDaemonEntry();
  checks.push(['daemon entry', !fromCheckout, fromCheckout ? `${entry} (git checkout — see install warning)` : entry]);

  for (const [name, ok, detail] of checks) {
    (ok ? success : warn)(`${name.padEnd(18)} ${detail}`);
  }
}

function status(): void {
  spawnSync('systemctl', ['status', '--no-pager', 'fleet-mcp.service'], { stdio: 'inherit' });
}

export function mcpManageCommand(args: string[]): void {
  const sub = args[0];
  try {
    switch (sub) {
      case 'install': return install(args.slice(1));
      case 'uninstall': return uninstall();
      case 'doctor': return doctor();
      case 'status': return status();
      default:
        error(`unknown: fleet mcp ${sub}. expected install|uninstall|doctor|status (or connect|daemon)`);
        process.exit(2);
    }
  } catch (e) {
    error((e as Error).message);
    process.exit(1);
  }
}
