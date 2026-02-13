import { load, findApp } from '../core/registry.js';
import { startService } from '../core/systemd.js';
import { AppNotFoundError } from '../core/errors.js';
import { success, error } from '../ui/output.js';

export function startCommand(args: string[]): void {
  const appName = args[0];
  if (!appName) {
    error('Usage: fleet start <app>');
    process.exit(1);
  }

  const reg = load();
  const app = findApp(reg, appName);
  if (!app) throw new AppNotFoundError(appName);

  if (startService(app.serviceName)) {
    success(`Started ${app.name}`);
  } else {
    error(`Failed to start ${app.name}`);
    process.exit(1);
  }
}
