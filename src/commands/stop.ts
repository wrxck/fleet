import { load, findApp } from '../core/registry.js';
import { stopService } from '../core/systemd.js';
import { AppNotFoundError } from '../core/errors.js';
import { success, error } from '../ui/output.js';

export function stopCommand(args: string[]): void {
  const appName = args[0];
  if (!appName) {
    error('Usage: fleet stop <app>');
    process.exit(1);
  }

  const reg = load();
  const app = findApp(reg, appName);
  if (!app) throw new AppNotFoundError(appName);

  if (stopService(app.serviceName)) {
    success(`Stopped ${app.name}`);
  } else {
    error(`Failed to stop ${app.name}`);
    process.exit(1);
  }
}
