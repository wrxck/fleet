import { findApp, withRegistry } from '../core/registry.js';
import { stopService, disableService, enableService, startService } from '../core/systemd.js';
import { AppNotFoundError } from '../core/errors.js';
import { success, error } from '../ui/output.js';

export async function freezeApp(appName: string, reason?: string): Promise<void> {
  await withRegistry(reg => {
    const app = findApp(reg, appName);
    if (!app) throw new AppNotFoundError(appName);
    if (app.frozenAt) {
      throw new Error(`App "${appName}" is already frozen (since ${app.frozenAt})`);
    }

    stopService(app.serviceName);
    disableService(app.serviceName);

    app.frozenAt = new Date().toISOString();
    if (reason) app.frozenReason = reason;

    return reg;
  });
}

export async function unfreezeApp(appName: string): Promise<void> {
  let serviceName: string | null = null;

  await withRegistry(reg => {
    const app = findApp(reg, appName);
    if (!app) throw new AppNotFoundError(appName);
    if (!app.frozenAt) {
      throw new Error(`App "${appName}" is not frozen`);
    }

    delete app.frozenAt;
    delete app.frozenReason;
    serviceName = app.serviceName;

    return reg;
  });

  // Service operations run AFTER the lock is released so we don't hold the
  // registry lock while systemctl is starting things up.
  if (serviceName) {
    enableService(serviceName);
    startService(serviceName);
  }
}

export async function freezeCommand(args: string[]): Promise<void> {
  const appName = args[0];
  if (!appName) {
    error('Usage: fleet freeze <app> [reason]');
    process.exit(1);
  }
  const reason = args.slice(1).join(' ') || undefined;

  try {
    await freezeApp(appName, reason);
    success(`Frozen ${appName}${reason ? `: ${reason}` : ''}`);
  } catch (err) {
    error((err as Error).message);
    process.exit(1);
  }
}

export async function unfreezeCommand(args: string[]): Promise<void> {
  const appName = args[0];
  if (!appName) {
    error('Usage: fleet unfreeze <app>');
    process.exit(1);
  }

  try {
    await unfreezeApp(appName);
    success(`Unfrozen ${appName} — service enabled and started`);
  } catch (err) {
    error((err as Error).message);
    process.exit(1);
  }
}
