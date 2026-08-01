import { installServiceForApp } from '../core/service-install';
import { success, error, info } from '../ui/output';

/**
 * `fleet service install <app> [--force]` — scaffold the systemd unit for a
 * registered app from its trusted registry fields. This is the path for apps
 * registered with a custom name/composeFile, which `fleet add` never covers.
 */
export async function serviceCommand(args: string[]): Promise<void> {
  const sub = args[0];
  if (sub !== 'install') {
    error('Usage: fleet service install <app> [--force]');
    process.exit(1);
  }

  const rest = args.slice(1);
  const force = rest.includes('--force');
  const app = rest.find(a => !a.startsWith('-'));

  if (!app) {
    error('Usage: fleet service install <app> [--force]');
    process.exit(1);
  }

  const result = installServiceForApp(app, { force });
  if (!result.ok) {
    error(result.message);
    process.exit(1);
  }
  success(result.message);
  info(`Start it with: fleet start ${app} (or fleet deploy ${app})`);
}
