import { describe, it, expect } from 'vitest';

import { createWebhookNotifier } from './webhook.js';

describe('webhook notifier', () => {
  it('POSTs a JSON payload with subject and body', async () => {
    let capturedUrl = '';
    let capturedInit: RequestInit | undefined;
    const fakeFetch: typeof fetch = async (url, init) => {
      capturedUrl = String(url);
      capturedInit = init;
      return new Response('ok', { status: 200 });
    };
    const notifier = createWebhookNotifier({ url: 'https://example.test/hook', fetcher: fakeFetch });
    await notifier.notify('subj', 'body', { routineId: 'r', runId: 'x', status: 'ok' });
    expect(capturedUrl).toBe('https://example.test/hook');
    expect(capturedInit?.method).toBe('POST');
    const headers = capturedInit?.headers as Record<string, string>;
    expect(headers?.['Content-Type']).toBe('application/json');
    const parsed = JSON.parse(String(capturedInit?.body)) as { subject: string; body: string; routineId: string };
    expect(parsed.subject).toBe('subj');
    expect(parsed.body).toBe('body');
    expect(parsed.routineId).toBe('r');
  });

  it('adds X-Fleet-Signature when a secret is configured', async () => {
    let signature = '';
    const fakeFetch: typeof fetch = async (_url, init) => {
      const h = (init?.headers as Record<string, string>) ?? {};
      signature = h['X-Fleet-Signature'] ?? '';
      return new Response('ok', { status: 200 });
    };
    const notifier = createWebhookNotifier({
      url: 'https://example.test/hook',
      secret: 'topsecret',
      fetcher: fakeFetch,
    });
    await notifier.notify('s', 'b', { routineId: 'r', runId: 'x', status: 'ok' });
    expect(signature).toMatch(/^sha256=[a-f0-9]{64}$/);
  });

  it('does not throw on non-2xx responses', async () => {
    const fakeFetch: typeof fetch = async () => new Response('boom', { status: 500 });
    const notifier = createWebhookNotifier({ url: 'https://example.test/hook', fetcher: fakeFetch });
    await expect(notifier.notify('s', 'b', { routineId: 'r', runId: 'x', status: 'failed' })).resolves.toBeUndefined();
  });

  it('does not throw when fetch throws', async () => {
    const fakeFetch: typeof fetch = async () => { throw new Error('connection refused'); };
    const notifier = createWebhookNotifier({ url: 'https://example.test/hook', fetcher: fakeFetch });
    await expect(notifier.notify('s', 'b', { routineId: 'r', runId: 'x', status: 'failed' })).resolves.toBeUndefined();
  });
});
