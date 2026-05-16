import { existsSync } from 'node:fs';

import { listContainers } from '../docker';
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

/** detect named docker volumes attached to the app's containers. anonymous
 * volumes (uuid names) are skipped — they're transient. */
export function detectVolumes(appName: string): string[] {
  const r = execSafe('docker', ['ps', '-q', '--filter', `name=${appName}`], { timeout: 5_000 });
  if (!r.ok) return [];
  const vols = new Set<string>();
  for (const cid of r.stdout.split('\n').filter(Boolean)) {
    const v = execSafe('docker', ['inspect', cid, '--format', '{{range .Mounts}}{{if eq .Type "volume"}}{{.Name}}|{{end}}{{end}}'], { timeout: 5_000 });
    for (const name of v.stdout.split('|').filter(Boolean)) {
      // skip anonymous (uuid-looking)
      if (!/^[0-9a-f]{60,}$/i.test(name)) {
        vols.add(name);
      }
    }
  }
  return [...vols].sort();
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
  const volumes = detectVolumes(appName);

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
