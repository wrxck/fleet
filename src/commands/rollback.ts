import { load, findApp } from '../core/registry.js';
import { execSafe } from '../core/exec.js';
import { restartService } from '../core/systemd.js';

function log(msg: string): void {
  process.stdout.write(`[rollback] ${msg}\n`);
}

function logErr(msg: string): void {
  process.stderr.write(`[rollback] ${msg}\n`);
}

function resolveImageName(composePath: string, composeFile: string | null): string | null {
  const args = ['compose', ...(composeFile ? ['-f', composeFile] : []), 'config', '--images'];
  const r = execSafe('docker', args, { cwd: composePath, timeout: 15_000 });
  if (!r.ok) return null;
  return r.stdout.split('\n').filter(Boolean)[0] ?? null;
}

function splitImageBase(image: string): string {
  const lastColon = image.lastIndexOf(':');
  if (lastColon <= 0) return image;
  return image.slice(0, lastColon);
}

export async function rollbackCommand(args: string[]): Promise<void> {
  const appName = args[0];
  if (!appName) {
    logErr('Usage: fleet rollback <app>');
    process.exit(1);
  }

  const reg = load();
  const app = findApp(reg, appName);
  if (!app) {
    logErr(`app not found: ${appName}`);
    process.exit(1);
  }

  const image = resolveImageName(app.composePath, app.composeFile);
  if (!image) {
    logErr(`could not resolve image name for ${app.name}`);
    process.exit(1);
  }
  const base = splitImageBase(image);
  const previous = `${base}:fleet-previous`;
  const latest = image;

  if (!execSafe('docker', ['image', 'inspect', previous], { timeout: 10_000 }).ok) {
    logErr(`no previous image found (${previous}) — nothing to roll back to`);
    process.exit(1);
  }

  const tag = execSafe('docker', ['tag', previous, latest], { timeout: 10_000 });
  if (!tag.ok) {
    logErr(`docker tag failed: ${tag.stderr || `exit ${tag.exitCode}`}`);
    process.exit(1);
  }

  const ok = restartService(app.serviceName);
  if (!ok) {
    logErr(`tag restored but service restart failed for ${app.serviceName}`);
    process.exit(1);
  }
  log(`rolled back ${app.name} to ${previous}`);
}
