import { readFileSync, existsSync } from 'node:fs';

import { load } from '../core/registry.js';
import { checkAllHealth } from '../core/health.js';
import { getServiceStatus } from '../core/systemd.js';
import { error, success, warn } from '../ui/output.js';

const TELEGRAM_CONFIG_PATH = '/etc/fleet/telegram.json';

interface TelegramConfig {
  botToken: string;
  chatId: string;
}

function loadTelegramConfig(): TelegramConfig | null {
  if (!existsSync(TELEGRAM_CONFIG_PATH)) return null;
  try {
    return JSON.parse(readFileSync(TELEGRAM_CONFIG_PATH, 'utf-8'));
  } catch {
    return null;
  }
}

async function sendTelegram(config: TelegramConfig, message: string): Promise<boolean> {
  try {
    const url = `https://api.telegram.org/bot${config.botToken}/sendMessage`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: config.chatId,
        text: message,
        parse_mode: 'HTML',
      }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

function getHostname(): string {
  try {
    return readFileSync('/etc/hostname', 'utf-8').trim();
  } catch {
    return 'unknown';
  }
}

export async function watchdogCommand(_args: string[]): Promise<void> {
  const failures: string[] = [];
  const hostname = getHostname();

  // check docker-databases systemd status
  const dbStatus = getServiceStatus('docker-databases');
  if (!dbStatus.active) {
    failures.push(`docker-databases: systemd ${dbStatus.state}`);
  }

  // check all registered apps
  const reg = load();
  const results = checkAllHealth(reg.apps);

  for (const r of results) {
    if (r.overall === 'down') {
      failures.push(`${r.app}: down (systemd: ${r.systemd.state})`);
    } else if (r.overall === 'degraded') {
      const reasons: string[] = [];
      if (!r.systemd.ok) reasons.push(`systemd: ${r.systemd.state}`);
      const deadContainers = r.containers.filter(c => !c.running).map(c => c.name);
      if (deadContainers.length > 0) reasons.push(`containers down: ${deadContainers.join(', ')}`);
      if (r.http && !r.http.ok) reasons.push('http check failed');
      failures.push(`${r.app}: degraded (${reasons.join('; ')})`);
    }
  }

  if (failures.length === 0) {
    success(`All ${results.length + 1} services healthy`);
    return;
  }

  const summary = `${failures.length} service(s) unhealthy`;
  warn(summary);
  for (const f of failures) {
    error(`  ${f}`);
  }

  // send telegram alert
  const config = loadTelegramConfig();
  if (!config) {
    warn('No telegram config at /etc/fleet/telegram.json — alert not sent');
    process.exit(1);
  }

  const message = [
    `<b>fleet watchdog alert</b>`,
    `<b>host:</b> ${hostname}`,
    `<b>failures:</b> ${failures.length}`,
    '',
    ...failures.map(f => `- ${f}`),
  ].join('\n');

  const sent = await sendTelegram(config, message);
  if (sent) {
    success('Telegram alert sent');
  } else {
    error('Failed to send Telegram alert');
  }

  process.exit(1);
}
