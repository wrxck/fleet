import { existsSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';

import { execSafe } from './exec.js';
import { assertDomain } from './validate.js';

const SITES_AVAILABLE = '/etc/nginx/sites-available';
const SITES_ENABLED = '/etc/nginx/sites-enabled';

export interface NginxSite {
  domain: string;
  configFile: string;
  enabled: boolean;
  ssl: boolean;
}

export function listSites(): NginxSite[] {
  if (!existsSync(SITES_AVAILABLE)) return [];

  const files = readdirSync(SITES_AVAILABLE).filter(f =>
    f.endsWith('.conf') && !f.startsWith('default')
  );

  return files.map(file => {
    const content = readFileSync(`${SITES_AVAILABLE}/${file}`, 'utf-8');
    const domain = file.replace('.conf', '');
    const enabled = existsSync(`${SITES_ENABLED}/${file}`);
    const ssl = content.includes('ssl_certificate') || content.includes('listen 443');
    return { domain, configFile: file, enabled, ssl };
  });
}

export function installConfig(domain: string, content: string): void {
  assertDomain(domain);
  const filename = `${domain}.conf`;
  writeFileSync(`${SITES_AVAILABLE}/${filename}`, content);
  const enabledPath = `${SITES_ENABLED}/${filename}`;
  if (!existsSync(enabledPath)) {
    execSafe('ln', ['-sf', `${SITES_AVAILABLE}/${filename}`, enabledPath]);
  }
}

export function removeConfig(domain: string): boolean {
  assertDomain(domain);
  const filename = `${domain}.conf`;
  const available = `${SITES_AVAILABLE}/${filename}`;
  const enabled = `${SITES_ENABLED}/${filename}`;

  if (existsSync(enabled)) unlinkSync(enabled);
  if (existsSync(available)) {
    unlinkSync(available);
    return true;
  }
  return false;
}

export function testConfig(): { ok: boolean; output: string } {
  const result = execSafe('nginx', ['-t'], { timeout: 10_000 });
  return { ok: result.ok || result.stderr.includes('successful'), output: result.stderr || result.stdout };
}

export function reload(): boolean {
  return execSafe('systemctl', ['reload', 'nginx'], { timeout: 10_000 }).ok;
}

export function readConfig(domain: string): string | null {
  assertDomain(domain);
  const path = `${SITES_AVAILABLE}/${domain}.conf`;
  if (!existsSync(path)) return null;
  return readFileSync(path, 'utf-8');
}

export function extractPortFromConfig(content: string): number | null {
  const match = content.match(/proxy_pass\s+https?:\/\/(?:127\.0\.0\.1|localhost):(\d+)/);
  return match ? parseInt(match[1], 10) : null;
}

export function extractDomainsFromConfig(content: string): string[] {
  const match = content.match(/server_name\s+([^;]+);/);
  if (!match) return [];
  return match[1].split(/\s+/).filter(d => d && d !== '_');
}
