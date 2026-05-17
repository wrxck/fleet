import { existsSync, readFileSync } from 'node:fs';

import { z } from 'zod';

import { withRegistry } from '../core/registry';
import type { AppEntry, Registry } from '../core/registry';
import { discoverServices, parseServiceFile, readServiceFile } from '../core/systemd';
import { listContainers, getContainersByCompose } from '../core/docker';
import { listSites, readConfig, extractPortFromConfig, extractDomainsFromConfig } from '../core/nginx';
import { defineCommand } from '../registry/registry';
import type { CommandResult } from '../registry/types';

const SKIP_SERVICES = ['docker-databases'];

export const initCommand = defineCommand({
  name: 'init',
  summary: 'Auto-discover all existing apps',
  args: z.object({}),
  async run(_args, ctx): Promise<CommandResult<Registry>> {
    ctx.log({ level: 'info', message: 'fleet init — auto-discovering apps' });

    const services = discoverServices();
    const containers = listContainers();
    const sites = listSites();

    ctx.log({ level: 'info', message: `found ${services.length} compose services, ${containers.length} running containers, ${sites.length} nginx sites` });

    let added = 0;
    // assigned inside the withRegistry callback below, which always runs.
    let discovered!: Registry;

    await withRegistry(reg => {
      for (const serviceName of services) {
        if (SKIP_SERVICES.includes(serviceName)) continue;

        const content = readServiceFile(serviceName);
        if (!content) continue;

        const parsed = parseServiceFile(content);
        if (!parsed.workingDirectory) continue;

        const composePath = parsed.workingDirectory;
        const composeFile = parsed.composeFile;
        const composeContainers = getContainersByCompose(composePath, composeFile);

        const port = detectPort(composePath, composeFile, composeContainers, containers);
        const domains = detectDomains(serviceName, sites, port);
        const usesSharedDb = detectSharedDb(composePath, composeFile);
        const type = detectType(composePath, composeFile, domains);
        const displayName = detectDisplayName(serviceName, content);

        const app: AppEntry = {
          name: serviceName,
          displayName,
          composePath,
          composeFile,
          serviceName,
          domains,
          port,
          usesSharedDb,
          type,
          containers: composeContainers.length > 0 ? composeContainers : [serviceName],
          dependsOnDatabases: parsed.dependsOnDatabases,
          registeredAt: new Date().toISOString(),
        };

        const existing = reg.apps.findIndex(a => a.name === serviceName);
        if (existing >= 0) {
          const prev = reg.apps[existing];
          if (prev.healthPath) app.healthPath = prev.healthPath;
          if (prev.gitRepo) app.gitRepo = prev.gitRepo;
          if (prev.gitRemoteUrl) app.gitRemoteUrl = prev.gitRemoteUrl;
          if (prev.gitOnboardedAt) app.gitOnboardedAt = prev.gitOnboardedAt;
          if (prev.secretsManaged) app.secretsManaged = prev.secretsManaged;
          reg.apps[existing] = app;
        } else {
          reg.apps.push(app);
        }
        added++;
        ctx.log({ level: 'info', message: `${serviceName} (${composePath})` });
      }
      discovered = reg;
      return reg;
    });

    return {
      ok: true,
      summary: `registered ${added} app${added === 1 ? '' : 's'}`,
      data: discovered,
      render: {
        kind: 'table',
        columns: ['NAME', 'PATH', 'TYPE', 'PORT'],
        rows: discovered.apps.map(a => [a.name, a.composePath, a.type, a.port?.toString() ?? '—']),
      },
    };
  },
});

function detectPort(
  composePath: string,
  composeFile: string | null,
  composeContainers: string[],
  allContainers: ReturnType<typeof listContainers>
): number | null {
  const file = composeFile ?? 'docker-compose.yml';
  const fullPath = `${composePath}/${file}`;

  if (existsSync(fullPath)) {
    const content = readFileSync(fullPath, 'utf-8');
    const portsRe = new RegExp('ports:\\s*\\n\\s*-\\s*"?(\\d+)' + ':(\\d+)"?');
    const portMatch = content.match(portsRe);
    if (portMatch) {
      return parseInt(portMatch[1], 10);
    }
    const localhostMatch = content.match(/127\.0\.0\.1:(\d+):/);
    if (localhostMatch) {
      return parseInt(localhostMatch[1], 10);
    }
  }

  for (const name of composeContainers) {
    const ct = allContainers.find(c => c.name === name);
    if (ct?.ports) {
      const portMatch = ct.ports.match(/(?:0\.0\.0\.0|127\.0\.0\.1):(\d+)->/);
      if (portMatch) return parseInt(portMatch[1], 10);
    }
  }

  return null;
}

function detectDomains(
  serviceName: string,
  sites: ReturnType<typeof listSites>,
  port: number | null
): string[] {
  for (const site of sites) {
    const config = readConfig(site.domain);
    if (!config) continue;

    if (port) {
      const configPort = extractPortFromConfig(config);
      if (configPort === port) {
        return extractDomainsFromConfig(config);
      }
    }

    if (config.toLowerCase().includes(serviceName)) {
      return extractDomainsFromConfig(config);
    }
  }
  return [];
}

function detectSharedDb(composePath: string, composeFile: string | null): boolean {
  const file = composeFile ?? 'docker-compose.yml';
  const fullPath = `${composePath}/${file}`;
  if (!existsSync(fullPath)) return false;
  const content = readFileSync(fullPath, 'utf-8');
  return content.includes('databases') && content.includes('external: true');
}

function detectType(
  composePath: string,
  composeFile: string | null,
  domains: string[]
): 'spa' | 'proxy' | 'nextjs' | 'service' {
  const file = composeFile ?? 'docker-compose.yml';
  const fullPath = `${composePath}/${file}`;

  if (existsSync(fullPath)) {
    const content = readFileSync(fullPath, 'utf-8');
    if (content.includes('next') || content.includes('Next')) return 'nextjs';
  }

  if (domains.length > 0) {
    for (const domain of domains) {
      const config = readConfig(domain);
      if (!config) continue;
      if (config.includes('try_files') && config.includes('index.html')) return 'spa';
      if (config.includes('_next/')) return 'nextjs';
    }
    return 'proxy';
  }

  return 'service';
}

function detectDisplayName(serviceName: string, serviceContent: string): string {
  const descMatch = serviceContent.match(/Description=(.+?)(?:\s+Docker| Service| Container)/);
  if (descMatch) return descMatch[1].trim();
  return serviceName;
}
