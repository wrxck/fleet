import { readFileSync, existsSync } from 'node:fs';
import { exec } from './exec.js';

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
  const result = exec(
    'docker ps --format "{{.Names}}\\t{{.Status}}\\t{{.Ports}}\\t{{.Image}}"',
    { timeout: 10_000 }
  );
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
  const fileFlag = composeFile ? `-f ${composeFile}` : '';
  const result = exec(
    `docker compose ${fileFlag} ps --format "{{.Names}}"`,
    { cwd: composePath, timeout: 10_000 }
  );
  if (!result.ok || !result.stdout) return [];
  return result.stdout.split('\n').filter(Boolean);
}

export function getContainerLogs(container: string, lines = 100): string {
  const result = exec(`docker logs --tail ${lines} ${container} 2>&1`, { timeout: 15_000 });
  return result.ok ? result.stdout : result.stderr || 'No logs available';
}

export function composeBuild(composePath: string, composeFile: string | null, appName?: string): boolean {
  const fileFlag = composeFile ? `-f ${composeFile}` : '';
  const env = appName ? loadEnvFile(`${SECRETS_BASE}/${appName}/.env`) : {};
  const result = exec(
    `docker compose ${fileFlag} build`,
    { cwd: composePath, timeout: 300_000, env: Object.keys(env).length > 0 ? env : undefined }
  );
  return result.ok;
}

export function composeUp(composePath: string, composeFile: string | null): boolean {
  const fileFlag = composeFile ? `-f ${composeFile}` : '';
  const result = exec(
    `docker compose ${fileFlag} up -d --force-recreate`,
    { cwd: composePath, timeout: 120_000 }
  );
  return result.ok;
}

export function composeDown(composePath: string, composeFile: string | null): boolean {
  const fileFlag = composeFile ? `-f ${composeFile}` : '';
  const result = exec(
    `docker compose ${fileFlag} down`,
    { cwd: composePath, timeout: 60_000 }
  );
  return result.ok;
}

export function inspectContainer(name: string): Record<string, unknown> | null {
  const result = exec(`docker inspect ${name}`, { timeout: 10_000 });
  if (!result.ok) return null;
  const parsed = JSON.parse(result.stdout);
  return Array.isArray(parsed) ? parsed[0] : parsed;
}
