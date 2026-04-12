import { readFileSync, existsSync } from 'node:fs';

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

export async function sendNotification(config: NotifyConfig, message: string): Promise<boolean> {
  let anySuccess = false;
  for (const adapter of config.adapters) {
    try {
      const ok = adapter.type === 'bluebubbles'
        ? await sendBlueBubbles(adapter, message)
        : await sendTelegram(adapter, message);
      if (ok) anySuccess = true;
    } catch (err) {
      console.error(`notify (${adapter.type}): ${err}`);
    }
  }
  return anySuccess;
}

async function sendBlueBubbles(cfg: NotifyAdapterConfig, message: string): Promise<boolean> {
  const url = `${cfg.serverUrl}/api/v1/message/text?password=${cfg.password}`;
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

async function sendTelegram(cfg: NotifyAdapterConfig, message: string): Promise<boolean> {
  const res = await fetch(
    `https://api.telegram.org/bot${cfg.botToken}/sendMessage`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: cfg.chatId, text: message, parse_mode: 'HTML' }),
    }
  );
  return res.ok;
}
