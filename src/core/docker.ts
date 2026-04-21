import { readFileSync, existsSync } from 'node:fs';
import { execSafe } from './exec.js';

const SECRETS_BASE = '/run/fleet-secrets';

function loadEnvFile(path: string): Record<string, string> {
  if (!existsSync(path)) return {};
  const vars: Record<string, string> = {};
  for (const line of readFileSync(path, 'utf-8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq < 1) continue;
    const key = trimmed.slice(0, eq);
    let val = trimmed.slice(eq + 1);
    // Strip surrounding quotes
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    vars[key] = val;
  }
  return vars;
}

export interface ContainerInfo {
  name: string;
  status: string;
  health: string;
  ports: string;
  image: string;
  uptime: string;
}

export function listContainers(): ContainerInfo[] {
  const result = execSafe('docker', [
    'ps', '--format', '{{.Names}}\t{{.Status}}\t{{.Ports}}\t{{.Image}}',
  ], { timeout: 10_000 });
  if (!result.ok || !result.stdout) return [];

  return result.stdout.split('\n').map(line => {
    const [name, rawStatus, ports, image] = line.split('\t');
    const health = rawStatus.includes('(healthy)') ? 'healthy'
      : rawStatus.includes('(unhealthy)') ? 'unhealthy'
      : rawStatus.includes('(health:') ? 'starting'
      : 'none';
    const uptime = rawStatus.replace(/\s*\(.*?\)\s*/g, '').replace(/^Up\s+/, '');
    return { name, status: rawStatus, health, ports: ports ?? '', image: image ?? '', uptime };
  });
}

export function getContainersByCompose(composePath: string, composeFile: string | null): string[] {
  const args = ['compose', ...(composeFile ? ['-f', composeFile] : []), 'ps', '--format', '{{.Names}}'];
  const result = execSafe('docker', args, { cwd: composePath, timeout: 10_000 });
  if (!result.ok || !result.stdout) return [];
  return result.stdout.split('\n').filter(Boolean);
}

export function getContainerLogs(container: string, lines = 100): string {
  const result = execSafe('docker', ['logs', '--tail', String(lines), container], { timeout: 15_000 });
  return result.ok ? (result.stdout || result.stderr) : result.stderr || 'No logs available';
}

function resolveImageName(composePath: string, composeFile: string | null): string | null {
  const args = ['compose', ...(composeFile ? ['-f', composeFile] : []), 'config', '--images'];
  const r = execSafe('docker', args, { cwd: composePath, timeout: 15_000 });
  if (!r.ok) return null;
  const first = r.stdout.split('\n').filter(Boolean)[0];
  return first ?? null;
}

function imageExists(image: string): boolean {
  return execSafe('docker', ['image', 'inspect', image], { timeout: 10_000 }).ok;
}

export function composeBuild(composePath: string, composeFile: string | null, appName?: string): boolean {
  const image = resolveImageName(composePath, composeFile);
  if (image && imageExists(image)) {
    const lastColon = image.lastIndexOf(':');
    const base = lastColon > 0 ? image.slice(0, lastColon) : image;
    const previous = `${base}:fleet-previous`;
    execSafe('docker', ['tag', image, previous], { timeout: 10_000 });
    // intentional: retag failure does not block build
  }
  const args = ['compose', ...(composeFile ? ['-f', composeFile] : []), 'build'];
  const env = appName ? loadEnvFile(`${SECRETS_BASE}/${appName}/.env`) : {};
  const result = execSafe('docker', args, {
    cwd: composePath,
    timeout: 300_000,
    env: Object.keys(env).length > 0 ? env : undefined,
  });
  return result.ok;
}

export function composeUp(composePath: string, composeFile: string | null): boolean {
  const args = ['compose', ...(composeFile ? ['-f', composeFile] : []), 'up', '-d', '--force-recreate'];
  const result = execSafe('docker', args, { cwd: composePath, timeout: 120_000 });
  return result.ok;
}

export function composeDown(composePath: string, composeFile: string | null): boolean {
  const args = ['compose', ...(composeFile ? ['-f', composeFile] : []), 'down'];
  const result = execSafe('docker', args, { cwd: composePath, timeout: 60_000 });
  return result.ok;
}

export function inspectContainer(name: string): Record<string, unknown> | null {
  const result = execSafe('docker', ['inspect', name], { timeout: 10_000 });
  if (!result.ok) return null;
  try {
    const parsed = JSON.parse(result.stdout);
    return Array.isArray(parsed) ? parsed[0] : parsed;
  } catch {
    return null;
  }
}
