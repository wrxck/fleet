import { createHmac } from 'node:crypto';

import type { NotifierAdapter } from '../types.js';

export interface WebhookOptions {
  url: string;
  secret?: string;
  headers?: Record<string, string>;
  fetcher?: typeof fetch;
  timeoutMs?: number;
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
          process.stderr.write(`[webhook] ${opts.url} returned ${res.status}\n`);
        }
      } catch (err) {
        process.stderr.write(`[webhook] ${opts.url} failed: ${(err as Error).message}\n`);
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
