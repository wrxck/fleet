import { load, save, findApp, removeApp } from '../core/registry';
import { stopService, disableService } from '../core/systemd';
import { AppNotFoundError } from '../core/errors';
import { success, error, info, warn } from '../ui/output';
import { confirm } from '../ui/confirm';

export async function removeCommand(args: string[]): Promise<void> {
  const yes = args.includes('-y') || args.includes('--yes');
  const appName = args.find(a => !a.startsWith('-'));

  if (!appName) {
    error('Usage: fleet remove <app>');
    process.exit(1);
  }

  const reg = load();
  const app = findApp(reg, appName);
  if (!app) throw new AppNotFoundError(appName);

  if (!yes && !await confirm(`Remove ${app.name}? This will stop and disable the service.`)) {
    info('Cancelled');
    return;
  }

  info(`Stopping ${app.serviceName}...`);
  stopService(app.serviceName);

  info(`Disabling ${app.serviceName}...`);
  disableService(app.serviceName);

  save(removeApp(reg, app.name));
  success(`Removed ${app.name} from registry`);
  warn('Service file not deleted - remove manually if needed');
}
