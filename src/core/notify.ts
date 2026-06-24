import { readFileSync, existsSync } from 'node:fs';

import { sendTelegram } from './telegram';

const NOTIFY_CONFIG_PATH = '/etc/fleet/notify.json';

export interface NotifyAdapterConfig {
  type: 'bluebubbles' | 'telegram';
  serverUrl?: string;
  password?: string;
  chatGuid?: string;
  cfAccessClientId?: string;
  cfAccessClientSecret?: string;
  botToken?: string;
  chatId?: string;
}

export interface NotifyConfig {
  adapters: NotifyAdapterConfig[];
}

export function loadNotifyConfig(): NotifyConfig | null {
  if (!existsSync(NOTIFY_CONFIG_PATH)) return null;
  try {
    return JSON.parse(readFileSync(NOTIFY_CONFIG_PATH, 'utf-8'));
  } catch {
    return null;
  }
}

/** remove an adapter's secrets from a string before it is logged. fetch/undici
 *  errors and tokenised API URLs can carry the bot token or password verbatim,
 *  and notify logs frequently ship onward (telegram, aggregators). */
export function scrubSecrets(text: string, secrets: Array<string | undefined>): string {
  let out = text;
  for (const s of secrets) {
    if (!s) continue;
    out = out.split(s).join('[redacted]');
    // also catch percent-encoded copies (e.g. password in a URL query string)
    const enc = encodeURIComponent(s);
    if (enc !== s) out = out.split(enc).join('[redacted]');
  }
  return out;
}

export async function sendNotification(config: NotifyConfig, message: string): Promise<boolean> {
  let anySuccess = false;
  for (const adapter of config.adapters) {
    try {
      const ok = adapter.type === 'bluebubbles'
        ? await sendBlueBubbles(adapter, message)
        : await sendTelegram({ botToken: adapter.botToken ?? '', chatId: adapter.chatId ?? '' }, message);
      if (ok) {
        anySuccess = true;
      } else if (adapter.type === 'telegram') {
        // sendTelegram swallows its own fetch error and returns false; surface a
        // line so a misconfigured/unreachable telegram is still visible in logs.
        console.error('notify (telegram): send failed');
      }
    } catch (err) {
      const msg = scrubSecrets(String(err), [adapter.password, adapter.botToken, adapter.cfAccessClientSecret]);
      console.error(`notify (${adapter.type}): ${msg}`);
    }
  }
  return anySuccess;
}

/** build the BlueBubbles send URL. the password is a query param (the API's
 *  required shape), so it MUST be percent-encoded — an un-encoded `&`/`#`/space
 *  in the secret would otherwise corrupt the request or leak into other params. */
export function buildBlueBubblesUrl(serverUrl: string, password: string): string {
  const base = serverUrl.replace(/\/+$/, '');
  return `${base}/api/v1/message/text?password=${encodeURIComponent(password)}`;
}

async function sendBlueBubbles(cfg: NotifyAdapterConfig, message: string): Promise<boolean> {
  const url = buildBlueBubblesUrl(cfg.serverUrl ?? '', cfg.password ?? '');
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (cfg.cfAccessClientId) {
    headers['CF-Access-Client-Id'] = cfg.cfAccessClientId;
    headers['CF-Access-Client-Secret'] = cfg.cfAccessClientSecret!;
  }
  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      chatGuid: cfg.chatGuid,
      message,
      tempGuid: `fleet-${Date.now()}`,
      method: 'apple-script',
    }),
  });
  return res.ok;
}

