import { spawn } from 'node:child_process';
import { mkdirSync, openSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { c, error, heading, info, success, table, warn } from '../ui/output';

// dev mock servers are tracked in a user-writable state file (the /var/lib/fleet
// paths are root-owned and `fleet mock` runs unprivileged).
interface MockRecord {
  name: string;
  host: string;
  port: number;
  pid: number;
  baseUrl: string;
  startedAt: string;
}

type MockState = Record<string, MockRecord>;

const stateDir = (): string => join(homedir(), '.fleet');
const statePath = (): string => join(stateDir(), 'mocks.json');

const loadState = (): MockState => {
  try {
    return JSON.parse(readFileSync(statePath(), 'utf8')) as MockState;
  } catch {
    return {};
  }
};

const saveState = (state: MockState): void => {
  mkdirSync(stateDir(), { recursive: true });
  writeFileSync(statePath(), `${JSON.stringify(state, null, 2)}\n`);
};

const isAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

// resolve the installed wiremock-ts cli through its `./cli` export.
const resolveWiremockCli = (): string => {
  const localRequire = createRequire(import.meta.url);
  return localRequire.resolve('wiremock-ts/cli');
};

const flagValue = (args: string[], name: string): string | undefined => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
};

const firstPositional = (args: string[]): string | undefined => args.find(a => !a.startsWith('-'));

const sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

const waitForHealth = async (baseUrl: string): Promise<boolean> => {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const res = await fetch(`${baseUrl}/__admin/health`);
      if (res.ok) return true;
    } catch {
      // not listening yet — retry
    }
    await sleep(100);
  }
  return false;
};

const liveBaseUrl = (name: string): string | undefined => {
  const record = loadState()[name];
  return record && isAlive(record.pid) ? record.baseUrl : undefined;
};

// pure: build a stub mapping from the flags accepted by `fleet mock stub`.
export const buildMapping = (
  method: string,
  urlPath: string,
  status: number,
  opts: { json?: string; body?: string },
): { request: { method: string; urlPath: string }; response: Record<string, unknown> } => {
  const response: Record<string, unknown> = { status };
  if (opts.json !== undefined) response.jsonBody = JSON.parse(opts.json);
  else if (opts.body !== undefined) response.body = opts.body;
  return { request: { method: method.toUpperCase(), urlPath }, response };
};

export { flagValue, firstPositional };

export async function mockCommand(args: string[]): Promise<void> {
  const sub = args[0];
  const rest = args.slice(1);
  switch (sub) {
    case 'start':
      return mockStart(rest);
    case 'list':
      return mockList(rest);
    case 'stub':
      return mockStub(rest);
    case 'reset':
      return mockReset(rest);
    case 'stop':
      return mockStop(rest);
    default:
      error('Usage: fleet mock <start|list|stub|reset|stop>');
      process.exit(1);
  }
}

async function mockStart(args: string[]): Promise<void> {
  const name = firstPositional(args) ?? 'default';
  const host = flagValue(args, '--host') ?? '127.0.0.1';
  const port = Number.parseInt(flagValue(args, '--port') ?? '8080', 10);
  const mappings = flagValue(args, '--mappings');

  const state = loadState();
  const existing = state[name];
  if (existing && isAlive(existing.pid)) {
    warn(`mock '${name}' already running on ${existing.baseUrl} (pid ${existing.pid})`);
    return;
  }

  let cli: string;
  try {
    cli = resolveWiremockCli();
  } catch {
    error("cannot find wiremock-ts — run 'npm install wiremock-ts' in the fleet directory");
    process.exit(1);
  }

  mkdirSync(stateDir(), { recursive: true });
  const logPath = join(stateDir(), `mock-${name}.log`);
  const logFd = openSync(logPath, 'a');
  const cliArgs = [cli, '--port', String(port), '--host', host];
  if (mappings) cliArgs.push('--mappings', mappings);

  const child = spawn(process.execPath, cliArgs, { detached: true, stdio: ['ignore', logFd, logFd] });
  child.unref();
  if (child.pid === undefined) {
    error(`failed to spawn mock '${name}'`);
    process.exit(1);
  }

  const baseUrl = `http://${host}:${port}`;
  state[name] = { name, host, port, pid: child.pid, baseUrl, startedAt: new Date().toISOString() };
  saveState(state);

  if (await waitForHealth(baseUrl)) {
    success(`mock '${name}' listening on ${baseUrl} (admin at ${baseUrl}/__admin, pid ${child.pid})`);
    if (mappings) info(`loaded mappings from ${mappings}`);
  } else {
    warn(`mock '${name}' spawned (pid ${child.pid}) but health check timed out — see ${logPath}`);
  }
}

async function mockList(args: string[]): Promise<void> {
  const json = args.includes('--json');
  const records = Object.values(loadState());
  const live = records.filter(r => isAlive(r.pid));
  if (live.length !== records.length) {
    const next: MockState = {};
    for (const r of live) next[r.name] = r;
    saveState(next);
  }

  if (json) {
    process.stdout.write(`${JSON.stringify(live, null, 2)}\n`);
    return;
  }

  heading(`Mock servers (${live.length})`);
  if (live.length === 0) {
    info('no mocks running — start one with: fleet mock start <name> --port <port>');
    return;
  }

  const rows = await Promise.all(
    live.map(async r => {
      let stubs = '—';
      try {
        const res = await fetch(`${r.baseUrl}/__admin/mappings`);
        if (res.ok) {
          const payload = (await res.json()) as { mappings?: unknown[] };
          stubs = String(payload.mappings?.length ?? 0);
        }
      } catch {
        // server briefly unavailable — leave as unknown
      }
      return [`${c.bold}${r.name}${c.reset}`, r.baseUrl, String(r.pid), stubs];
    }),
  );
  table(['NAME', 'BASE URL', 'PID', 'STUBS'], rows);
  process.stdout.write('\n');
}

async function mockStub(args: string[]): Promise<void> {
  const name = firstPositional(args) ?? 'default';
  const url = flagValue(args, '--url');
  const method = (flagValue(args, '--method') ?? 'GET').toUpperCase();
  const statusValue = flagValue(args, '--status');
  const status = statusValue ? Number.parseInt(statusValue, 10) : 200;
  const json = flagValue(args, '--json');
  const body = flagValue(args, '--body');

  if (!url) {
    error("Usage: fleet mock stub <name> --url <path> [--method GET] [--status 200] [--json '{...}' | --body <text>]");
    process.exit(1);
  }

  const target = liveBaseUrl(name);
  if (!target) {
    error(`mock '${name}' is not running — start it with: fleet mock start ${name}`);
    process.exit(1);
  }

  const mapping = buildMapping(method, url, status, { json, body });
  const res = await fetch(`${target}/__admin/mappings`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(mapping),
  });
  if (!res.ok) {
    error(`failed to register stub (${res.status})`);
    process.exit(1);
  }
  const created = (await res.json()) as { id?: string };
  success(`stubbed ${method} ${url} -> ${status} on '${name}'${created.id ? ` (id ${created.id})` : ''}`);
}

async function mockReset(args: string[]): Promise<void> {
  const name = firstPositional(args) ?? 'default';
  const target = liveBaseUrl(name);
  if (!target) {
    error(`mock '${name}' is not running`);
    process.exit(1);
  }
  const res = await fetch(`${target}/__admin/reset`, { method: 'POST' });
  if (!res.ok) {
    error(`failed to reset '${name}' (${res.status})`);
    process.exit(1);
  }
  success(`reset stubs and request journal for '${name}'`);
}

async function mockStop(args: string[]): Promise<void> {
  const all = args.includes('--all');
  const name = firstPositional(args);
  const state = loadState();
  const targets = all ? Object.keys(state) : name ? [name] : [];
  if (targets.length === 0) {
    error('Usage: fleet mock stop <name|--all>');
    process.exit(1);
  }
  for (const target of targets) {
    const record = state[target];
    if (!record) {
      warn(`no mock named '${target}'`);
      continue;
    }
    if (isAlive(record.pid)) {
      try {
        process.kill(record.pid);
      } catch {
        // already gone
      }
    }
    delete state[target];
    success(`stopped mock '${target}'`);
  }
  saveState(state);
}
