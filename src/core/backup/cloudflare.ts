import { existsSync, readFileSync } from 'node:fs';

import { requireEnv } from '../env';
import { FleetError } from '../errors';
import { execSafe } from '../exec';

/** path to the cloudflare credentials ini. */
function cfCredIni(): string { return requireEnv('FLEET_CF_CRED'); }

export class CloudflareError extends FleetError {}

interface CfCreds {
  apiToken?: string;
  email?: string;
  apiKey?: string;
}

function loadCreds(): CfCreds {
  const credPath = cfCredIni();
  if (!existsSync(credPath)) return {};
  const lines = readFileSync(credPath, 'utf-8').split('\n');
  const out: CfCreds = {};
  for (const line of lines) {
    const t = line.trim();
    if (!t || t.startsWith('#') || t.startsWith('[')) continue;
    const eq = t.indexOf('=');
    if (eq < 1) continue;
    const k = t.slice(0, eq).trim().toLowerCase().replace(/[_-]/g, '');
    const v = t.slice(eq + 1).trim();
    if (k === 'dnscloudflareapitoken' || k === 'cfapitoken' || k === 'apitoken') {
      out.apiToken = v;
    } else if (k === 'dnscloudflareemail' || k === 'email') {
      out.email = v;
    } else if (k === 'dnscloudflareapikey' || k === 'apikey') {
      out.apiKey = v;
    }
  }
  return out;
}

function cfCurl(path: string, creds: CfCreds): { ok: boolean; stdout: string; stderr: string } {
  const headers: string[] = [];
  if (creds.apiToken) {
    headers.push('-H', `Authorization: Bearer ${creds.apiToken}`);
  } else if (creds.email && creds.apiKey) {
    headers.push('-H', `X-Auth-Email: ${creds.email}`);
    headers.push('-H', `X-Auth-Key: ${creds.apiKey}`);
  } else {
    return { ok: false, stdout: '', stderr: 'no cloudflare credentials found' };
  }
  const r = execSafe('curl', [
    '-sS', '-m', '30',
    ...headers,
    `https://api.cloudflare.com/client/v4${path}`,
  ], { timeout: 35_000 });
  return r;
}

/** export every zone's DNS records + page rules. returns a json blob suitable
 * for restic stdin. used by the `system` backup so we can rebuild dns from
 * a single file even if cloudflare account access is lost. */
export function exportAllZones(): string {
  const creds = loadCreds();
  if (!creds.apiToken && !(creds.email && creds.apiKey)) {
    throw new CloudflareError(`no cloudflare credentials at ${cfCredIni()}`);
  }

  const zonesResp = cfCurl('/zones?per_page=200', creds);
  if (!zonesResp.ok) throw new CloudflareError(`zone list failed: ${zonesResp.stderr}`);
  const zones = JSON.parse(zonesResp.stdout).result as Array<{ id: string; name: string }>;

  const out: Record<string, unknown> = { exportedAt: new Date().toISOString(), zones: [] };
  const zonesOut = out.zones as Array<Record<string, unknown>>;

  for (const z of zones) {
    const dns = cfCurl(`/zones/${z.id}/dns_records?per_page=1000`, creds);
    const pageRules = cfCurl(`/zones/${z.id}/pagerules?per_page=200`, creds);
    const settings = cfCurl(`/zones/${z.id}/settings`, creds);
    zonesOut.push({
      id: z.id,
      name: z.name,
      dnsRecords: dns.ok ? JSON.parse(dns.stdout).result : { error: dns.stderr },
      pageRules: pageRules.ok ? JSON.parse(pageRules.stdout).result : { error: pageRules.stderr },
      settings: settings.ok ? JSON.parse(settings.stdout).result : { error: settings.stderr },
    });
  }

  return JSON.stringify(out, null, 2);
}
