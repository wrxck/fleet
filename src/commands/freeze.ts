import { load, save, findApp } from '../core/registry.js';
import { stopService, disableService, enableService, startService } from '../core/systemd.js';
import { AppNotFoundError } from '../core/errors.js';
import { success, error } from '../ui/output.js';

export function freezeApp(appName: string, reason?: string): void {
  const reg = load();
  const app = findApp(reg, appName);
  if (!app) throw new AppNotFoundError(appName);
  if (app.frozenAt) {
    throw new Error(`App "${appName}" is already frozen (since ${app.frozenAt})`);
  }

  stopService(app.serviceName);
  disableService(app.serviceName);

  app.frozenAt = new Date().toISOString();
  if (reason) app.frozenReason = reason;

  save(reg);
}

export function unfreezeApp(appName: string): void {
  const reg = load();
  const app = findApp(reg, appName);
  if (!app) throw new AppNotFoundError(appName);
  if (!app.frozenAt) {
    throw new Error(`App "${appName}" is not frozen`);
  }

  delete app.frozenAt;
  delete app.frozenReason;

  save(reg);

  enableService(app.serviceName);
  startService(app.serviceName);
}

export function freezeCommand(args: string[]): void {
  const appName = args[0];
  if (!appName) {
    error('Usage: fleet freeze <app> [reason]');
    process.exit(1);
  }
  const reason = args.slice(1).join(' ') || undefined;

  try {
    freezeApp(appName, reason);
    success(`Frozen ${appName}${reason ? `: ${reason}` : ''}`);
  } catch (err) {
    error((err as Error).message);
    process.exit(1);
  }
}

export function unfreezeCommand(args: string[]): void {
  const appName = args[0];
  if (!appName) {
    error('Usage: fleet unfreeze <app>');
    process.exit(1);
  }

  try {
    unfreezeApp(appName);
    success(`Unfrozen ${appName} — service enabled and started`);
  } catch (err) {
    error((err as Error).message);
    process.exit(1);
  }
}
