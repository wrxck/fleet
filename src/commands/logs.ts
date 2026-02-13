import { load, findApp } from '../core/registry.js';
import { getContainerLogs } from '../core/docker.js';
import { execLive } from '../core/exec.js';
import { AppNotFoundError } from '../core/errors.js';
import { error } from '../ui/output.js';

export function logsCommand(args: string[]): void {
  const follow = args.includes('-f') || args.includes('--follow');
  const nIdx = args.indexOf('-n');
  const lines = nIdx >= 0 ? parseInt(args[nIdx + 1], 10) || 100 : 100;
  const appName = args.find(a => !a.startsWith('-') && (nIdx < 0 || args.indexOf(a) !== nIdx + 1));

  if (!appName) {
    error('Usage: fleet logs <app> [-f] [-n <lines>]');
    process.exit(1);
  }

  const reg = load();
  const app = findApp(reg, appName);
  if (!app) throw new AppNotFoundError(appName);

  const container = app.containers[0];
  if (!container) {
    error(`No containers registered for ${app.name}`);
    process.exit(1);
  }

  if (follow) {
    const code = execLive('docker', ['logs', '-f', '--tail', lines.toString(), container]);
    process.exit(code);
  } else {
    const output = getContainerLogs(container, lines);
    process.stdout.write(output + '\n');
  }
}
