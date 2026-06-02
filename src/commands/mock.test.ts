import { describe, expect, it } from 'vitest';

import { buildMapping, firstPositional, flagValue } from './mock';

describe('fleet mock helpers', () => {
  it('parses positionals and flag values', () => {
    const args = ['demo', '--url', '/x', '--status', '201'];
    expect(firstPositional(args)).toBe('demo');
    expect(flagValue(args, '--url')).toBe('/x');
    expect(flagValue(args, '--status')).toBe('201');
    expect(flagValue(args, '--missing')).toBeUndefined();
  });

  it('builds a json stub mapping', () => {
    const mapping = buildMapping('get', '/api', 200, { json: '{"ok":true}' });
    expect(mapping).toEqual({
      request: { method: 'GET', urlPath: '/api' },
      response: { status: 200, jsonBody: { ok: true } },
    });
  });

  it('builds a text-body stub mapping and upper-cases the method', () => {
    const mapping = buildMapping('post', '/echo', 201, { body: 'hi' });
    expect(mapping.request).toEqual({ method: 'POST', urlPath: '/echo' });
    expect(mapping.response).toEqual({ status: 201, body: 'hi' });
  });
});
