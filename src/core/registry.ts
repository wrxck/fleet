import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REGISTRY_PATH = join(__dirname, '..', '..', 'data', 'registry.json');

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
  registeredAt: string;
  frozenAt?: string;
  frozenReason?: string;
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
      databases: { serviceName: 'docker-databases', composePath: '/home/matt/docker-databases' },
      nginx: { configPath: '/etc/nginx' },
    },
  };
}

export function load(): Registry {
  if (!existsSync(REGISTRY_PATH)) return defaultRegistry();
  const raw = readFileSync(REGISTRY_PATH, 'utf-8');
  return JSON.parse(raw) as Registry;
}

export function save(reg: Registry): void {
  const dir = dirname(REGISTRY_PATH);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(REGISTRY_PATH, JSON.stringify(reg, null, 2) + '\n');
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
  return REGISTRY_PATH;
}
