import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync, renameSync, openSync, writeSync, fsyncSync, closeSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

function resolveRegistryPath(): string {
  return process.env.FLEET_REGISTRY_PATH
    ?? join(__dirname, '..', '..', 'data', 'registry.json');
}

export interface AppEntry {
  name: string;
  displayName: string;
  composePath: string;
  composeFile: string | null;
  serviceName: string;
  domains: string[];
  port: number | null;
  usesSharedDb: boolean;
  type: 'spa' | 'proxy' | 'nextjs' | 'service';
  containers: string[];
  dependsOnDatabases: boolean;
  healthPath?: string;
  secretsManaged?: boolean;
  gitRepo?: string;
  gitRemoteUrl?: string;
  gitOnboardedAt?: string;
  lastBuiltCommit?: string;
  registeredAt: string;
  frozenAt?: string;
  frozenReason?: string;
  /** Numeric UID/GID to chown /run/fleet-secrets/<app>/.env to after unseal.
   * If unset, file remains root:root 0600 (the safe default). Used only for
   * apps that read the env file directly from the host (rare); Docker apps
   * using env_file in compose don't need this. */
  runtimeUid?: number;
  runtimeGid?: number;
  /** Per-app age recipient public key (for fleet secrets harden --per-app).
   * When set, the vault is encrypted to (admin + this) recipients. */
  ageRecipient?: string;
}

export interface Registry {
  version: number;
  apps: AppEntry[];
  infrastructure: {
    databases: { serviceName: string; composePath: string };
    nginx: { configPath: string };
  };
}

function defaultRegistry(): Registry {
  return {
    version: 1,
    apps: [],
    infrastructure: {
      databases: { serviceName: 'docker-databases', composePath: '' },
      nginx: { configPath: '/etc/nginx' },
    },
  };
}

export function load(): Registry {
  const path = resolveRegistryPath();
  const bakPath = path + '.bak';
  if (existsSync(path)) {
    try {
      return JSON.parse(readFileSync(path, 'utf-8')) as Registry;
    } catch {
      process.stderr.write(`[registry] Warning: failed to parse ${path}, trying ${bakPath}\n`);
    }
  }
  if (existsSync(bakPath)) {
    try {
      return JSON.parse(readFileSync(bakPath, 'utf-8')) as Registry;
    } catch {
      process.stderr.write(`[registry] Warning: failed to parse ${bakPath}, using default\n`);
    }
  }
  return defaultRegistry();
}

export function save(reg: Registry): void {
  const path = resolveRegistryPath();
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  if (existsSync(path)) {
    let mainIsValid = false;
    try {
      JSON.parse(readFileSync(path, 'utf-8'));
      mainIsValid = true;
    } catch {
      process.stderr.write(`[registry] Warning: main registry unparsable, preserving existing .bak\n`);
    }
    if (mainIsValid) {
      try {
        copyFileSync(path, path + '.bak');
      } catch (err) {
        process.stderr.write(`[registry] Warning: failed to write .bak: ${err instanceof Error ? err.message : String(err)}\n`);
      }
    }
  }
  const tmp = path + '.tmp';
  const data = JSON.stringify(reg, null, 2) + '\n';
  const fd = openSync(tmp, 'w');
  try {
    writeSync(fd, data);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  renameSync(tmp, path);
}

export function findApp(reg: Registry, name: string): AppEntry | undefined {
  return reg.apps.find(a =>
    a.name === name || a.serviceName === name || a.displayName.toLowerCase() === name.toLowerCase()
  );
}

export function addApp(reg: Registry, app: AppEntry): Registry {
  const existing = reg.apps.findIndex(a => a.name === app.name);
  if (existing >= 0) {
    reg.apps[existing] = app;
  } else {
    reg.apps.push(app);
  }
  return reg;
}

export function removeApp(reg: Registry, name: string): Registry {
  reg.apps = reg.apps.filter(a => a.name !== name);
  return reg;
}

export function registryPath(): string {
  return resolveRegistryPath();
}
