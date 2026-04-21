import { load, findApp } from '../core/registry.js';
import { getContainerLogs } from '../core/docker.js';
import { execLive } from '../core/exec.js';
import { AppNotFoundError } from '../core/errors.js';
import { error } from '../ui/output.js';

export function logsCommand(args: string[]): void {
  const follow = args.includes('-f') || args.includes('--follow');
  const nIdx = args.indexOf('-n');
  const lines = nIdx >= 0 ? parseInt(args[nIdx + 1], 10) || 100 : 100;
  const cIdx = args.indexOf('-c');
  const containerArg = cIdx >= 0 ? args[cIdx + 1] : undefined;
  const skipIndices = new Set<number>();
  if (nIdx >= 0) { skipIndices.add(nIdx); skipIndices.add(nIdx + 1); }
  if (cIdx >= 0) { skipIndices.add(cIdx); skipIndices.add(cIdx + 1); }
  const appName = args.find((a, i) => !a.startsWith('-') && !skipIndices.has(i));

  if (!appName) {
    error('Usage: fleet logs <app> [-f] [-n <lines>] [-c <container>]');
    process.exit(1);
  }

  const reg = load();
  const app = findApp(reg, appName);
  if (!app) throw new AppNotFoundError(appName);

  if (app.containers.length === 0) {
    error(`No containers registered for ${app.name}`);
    process.exit(1);
  }

  let container: string;
  if (containerArg) {
    if (!app.containers.includes(containerArg)) {
      error(`Container "${containerArg}" not found in ${app.name}. Available:`);
      for (const c of app.containers) process.stderr.write(`  - ${c}\n`);
      process.exit(1);
    }
    container = containerArg;
  } else {
    container = app.containers[0];
  }

  if (follow) {
    const code = execLive('docker', ['logs', '-f', '--tail', lines.toString(), container]);
    process.exit(code);
  } else {
    const output = getContainerLogs(container, lines);
    process.stdout.write(output + '\n');
  }
}
