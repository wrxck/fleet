import { describe, it, expect, vi } from 'vitest';

import { createWebhookNotifier, redactUrl } from './webhook';

describe('redactUrl', () => {
  it('drops userinfo credentials', () => {
    expect(redactUrl('https://user:s3cret@host.test/hook')).toBe('https://host.test/hook');
  });
  it('drops the query string (token-bearing)', () => {
    expect(redactUrl('https://host.test/hook?token=abc123')).toBe('https://host.test/hook?[redacted]');
  });
  it('leaves a clean url untouched', () => {
    expect(redactUrl('https://host.test/hook')).toBe('https://host.test/hook');
  });
  it('falls back to stripping after ? on an unparseable url', () => {
    expect(redactUrl('not a url?token=x')).toBe('not a url?[redacted]');
  });
});

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

  it('redacts credentials from the url when logging an error', async () => {
    const writes: string[] = [];
    const spy = vi.spyOn(process.stderr, 'write').mockImplementation((c: string | Uint8Array) => {
      writes.push(String(c));
      return true;
    });
    const fakeFetch: typeof fetch = async () => new Response('boom', { status: 500 });
    const notifier = createWebhookNotifier({
      url: 'https://user:topsecret@example.test/hook?token=abc123',
      fetcher: fakeFetch,
    });
    await notifier.notify('s', 'b', { routineId: 'r', runId: 'x', status: 'failed' });
    spy.mockRestore();
    const logged = writes.join('');
    expect(logged).not.toContain('topsecret');
    expect(logged).not.toContain('abc123');
    expect(logged).toContain('[redacted]');
  });
});
