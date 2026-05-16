import { load, findApp, removeApp, withRegistry } from '../core/registry.js';
import { stopService, disableService } from '../core/systemd.js';
import { AppNotFoundError } from '../core/errors.js';
import { success, error, info, warn } from '../ui/output.js';
import { confirm } from '../ui/confirm.js';

export async function removeCommand(args: string[]): Promise<void> {
  const yes = args.includes('-y') || args.includes('--yes');
  const appName = args.find(a => !a.startsWith('-'));

  if (!appName) {
    error('Usage: fleet remove <app>');
    process.exit(1);
  }

  // Read first (without the lock) so we can prompt the user / run systemctl
  // outside the locked region. We re-resolve and remove inside withRegistry
  // so the actual mutation runs against a fresh-loaded registry.
  const previewReg = load();
  const previewApp = findApp(previewReg, appName);
  if (!previewApp) throw new AppNotFoundError(appName);

  if (!yes && !await confirm(`Remove ${previewApp.name}? This will stop and disable the service.`)) {
    info('Cancelled');
    return;
  }

  info(`Stopping ${previewApp.serviceName}...`);
  stopService(previewApp.serviceName);

  info(`Disabling ${previewApp.serviceName}...`);
  disableService(previewApp.serviceName);

  await withRegistry(reg => {
    const app = findApp(reg, appName);
    if (!app) throw new AppNotFoundError(appName);
    return removeApp(reg, app.name);
  });
  success(`Removed ${previewApp.name} from registry`);
  warn('Service file not deleted - remove manually if needed');
}
