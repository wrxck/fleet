import { load, findApp } from '../core/registry.js';
import { restartService } from '../core/systemd.js';
import { AppNotFoundError } from '../core/errors.js';
import { success, error } from '../ui/output.js';

export function restartCommand(args: string[]): void {
  const appName = args[0];
  if (!appName) {
    error('Usage: fleet restart <app>');
    process.exit(1);
  }

  const reg = load();
  const app = findApp(reg, appName);
  if (!app) throw new AppNotFoundError(appName);

  if (restartService(app.serviceName)) {
    success(`Restarted ${app.name}`);
  } else {
    error(`Failed to restart ${app.name}`);
    process.exit(1);
  }
}
