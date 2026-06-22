import { createHmac } from 'node:crypto';

import type { NotifierAdapter } from '../types';

export interface WebhookOptions {
  url: string;
  secret?: string;
  headers?: Record<string, string>;
  fetcher?: typeof fetch;
  timeoutMs?: number;
}

/** strip credentials from a URL before it is logged: drop any userinfo
 *  (user:pass@) and the entire query string (tokens are commonly passed as
 *  `?token=...`). on an unparseable URL fall back to the part before `?`. */
export function redactUrl(raw: string): string {
  try {
    const u = new URL(raw);
    u.username = '';
    u.password = '';
    u.search = u.search ? '?[redacted]' : '';
    return u.toString();
  } catch {
    const q = raw.indexOf('?');
    return q === -1 ? raw : `${raw.slice(0, q)}?[redacted]`;
  }
}

export function createWebhookNotifier(opts: WebhookOptions): NotifierAdapter {
  const fetcher = opts.fetcher ?? fetch;
  const timeoutMs = opts.timeoutMs ?? 10_000;

  return {
    id: 'webhook',
    async notify(subject, body, meta): Promise<void> {
      const payload = JSON.stringify({ subject, body, ...meta, at: new Date().toISOString() });
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        ...opts.headers,
      };
      if (opts.secret) {
        const sig = createHmac('sha256', opts.secret).update(payload).digest('hex');
        headers['X-Fleet-Signature'] = `sha256=${sig}`;
      }
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const res = await fetcher(opts.url, {
          method: 'POST',
          headers,
          body: payload,
          signal: controller.signal,
        });
        if (!res.ok) {
          process.stderr.write(`[webhook] ${redactUrl(opts.url)} returned ${res.status}\n`);
        }
      } catch (err) {
        process.stderr.write(`[webhook] ${redactUrl(opts.url)} failed: ${(err as Error).message}\n`);
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
