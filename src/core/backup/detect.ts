import { existsSync } from 'node:fs';

import { listContainers } from '../docker';
import { FleetError } from '../errors';
import { execSafe } from '../exec';
import { load as loadRegistry } from '../registry';

import { DEFAULT_RETENTION, DEFAULT_EXCLUDES } from './config';
import { AppBackupConfig, DumpHook, Schedule } from './types';

/** detect the db dump hook (if any) for a registered fleet app. matches by
 * container image keyword: postgres/mysql/mongo/redis. */
export function detectDumpHook(appName: string): DumpHook | undefined {
  const all = listContainers();
  const candidates = all.filter(c =>
    c.name.startsWith(appName) ||
    c.name.endsWith(`-${appName}`) ||
    c.name === appName,
  );
  for (const c of candidates) {
    const img = c.image.toLowerCase();
    if (img.includes('postgres') || img.includes('postgis')) {
      return { type: 'postgres', container: c.name };
    }
    if (img.startsWith('mysql') || img.includes('mariadb')) {
      return { type: 'mysql', container: c.name };
    }
    if (img.includes('mongo')) {
      return { type: 'mongo', container: c.name };
    }
    if (img.startsWith('redis')) {
      return { type: 'redis', container: c.name };
    }
  }
  return undefined;
}

const MOUNTS_FORMAT = '{{range .Mounts}}{{if eq .Type "volume"}}{{.Name}}|{{end}}{{end}}';

// null means docker could not inspect the container, so the caller can tell stale names from no volumes.
function namedVolumesOf(container: string): string[] | null {
  const v = execSafe('docker', ['inspect', '--type', 'container', container, '--format', MOUNTS_FORMAT], { timeout: 5_000 });
  if (!v.ok) return null;
  // skip anonymous (uuid-looking) volumes, they're transient
  return v.stdout.split('|').filter(n => n && !/^[0-9a-f]{60,}$/i.test(n));
}

/** detect named docker volumes attached to the app's containers. */
// prefer registry names: docker's name filter is a substring match (macpool hits macpool-staging).
export function detectVolumes(appName: string, containers?: string[], composeDir?: string): string[] {
  const vols = new Set<string>();
  let inspected = 0;
  for (const c of containers ?? []) {
    const names = namedVolumesOf(c);
    if (names === null) continue;
    inspected++;
    for (const n of names) vols.add(n);
  }
  if (inspected === 0) {
    // no registry name resolves (stale or never recorded), so fall back rather than drop the volumes.
    // the compose working dir is exact; the name filter is a substring match and the last resort.
    const filter = composeDir ? `label=com.docker.compose.project.working_dir=${composeDir}` : `name=${appName}`;
    const r = execSafe('docker', ['ps', '-a', '-q', '--filter', filter], { timeout: 5_000 });
    if (r.ok) {
      for (const id of r.stdout.split('\n').filter(Boolean)) {
        for (const n of namedVolumesOf(id) ?? []) vols.add(n);
      }
    }
  }
  return [...vols].sort();
}

// a volume docker no longer knows is skipped, but docker being down must fail the backup loudly.
export function resolveVolumeMountpoints(volumes: string[]): { paths: string[]; missing: string[] } {
  const paths: string[] = [];
  const missing: string[] = [];
  for (const name of volumes) {
    const r = execSafe('docker', ['volume', 'inspect', name, '--format', '{{.Mountpoint}}'], { timeout: 5_000 });
    const mp = r.stdout.trim();
    if (r.ok && mp) paths.push(mp);
    else if (/no such volume/i.test(r.stderr)) missing.push(name);
    else throw new FleetError(`docker volume inspect ${name} failed: ${r.stderr.trim() || 'no output'}`);
  }
  return { paths, missing };
}

/** fs snapshot paths: configured paths first, then volume mountpoints, without duplicates. */
export function mergeSnapshotPaths(paths: string[], volumePaths: string[]): string[] {
  return [...new Set([...paths, ...volumePaths])];
}

/** decide a sensible default schedule based on whether the app has a db. */
export function defaultScheduleFor(hasDump: boolean): Schedule {
  return hasDump ? 'hourly' : 'daily';
}

/** build a baseline config for a registered fleet app. */
export function detectAppConfig(appName: string): AppBackupConfig | null {
  const reg = loadRegistry();
  const app = reg.apps.find(a => a.name === appName);
  if (!app) return null;

  const composeDir = app.composePath;
  const paths = existsSync(composeDir) ? [composeDir] : [];

  const dump = detectDumpHook(appName);
  const volumes = detectVolumes(appName, app.containers, composeDir);

  return {
    app: appName,
    schedule: defaultScheduleFor(!!dump),
    paths,
    exclude: DEFAULT_EXCLUDES,
    volumes: volumes.length > 0 ? volumes : undefined,
    preDump: dump,
    retention: DEFAULT_RETENTION,
  };
}
