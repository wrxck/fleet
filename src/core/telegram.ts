import { readFileSync, existsSync } from 'node:fs';

const TELEGRAM_CONFIG_PATH = '/etc/fleet/telegram.json';

export interface TelegramConfig {
  botToken: string;
  chatId: string;
}

export function loadTelegramConfig(): TelegramConfig | null {
  if (!existsSync(TELEGRAM_CONFIG_PATH)) return null;
  try {
    const raw = JSON.parse(readFileSync(TELEGRAM_CONFIG_PATH, 'utf-8'));
    if (!raw.botToken || !raw.chatId) return null;
    return { botToken: String(raw.botToken), chatId: String(raw.chatId) };
  } catch {
    return null;
  }
}

export async function sendTelegram(config: TelegramConfig, message: string): Promise<boolean> {
  try {
    const res = await fetch(
      `https://api.telegram.org/bot${config.botToken}/sendMessage`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: config.chatId,
          text: message,
          parse_mode: 'HTML',
        }),
      }
    );
    return res.ok;
  } catch {
    return false;
  }
}
