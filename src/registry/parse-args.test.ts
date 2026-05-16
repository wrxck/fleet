import { describe, it, expect } from 'vitest';

import { z } from 'zod';

import { parseArgs } from './parse-args';

describe('parseArgs', () => {
  it('fills a positional from argv', () => {
    const schema = z.object({ app: z.string() });
    const r = parseArgs(schema, ['web']);
    expect(r.help).toBeFalsy();
    if (!r.help) {
      expect(r.ok).toBeTruthy();
      if (r.ok) expect(r.values).toEqual({ app: 'web' });
    }
  });

  it('treats a boolean field as a presence flag', () => {
    const schema = z.object({ app: z.string(), force: z.boolean().default(false) });
    const r = parseArgs(schema, ['web', '--force']);
    if (!r.help && r.ok) expect(r.values).toEqual({ app: 'web', force: true });
    else throw new Error('expected ok parse');
  });

  it('reads a non-boolean field from a --key value flag', () => {
    const schema = z.object({ app: z.string(), from: z.string().optional() });
    const r = parseArgs(schema, ['web', '--from', 'develop']);
    if (!r.help && r.ok) expect(r.values).toEqual({ app: 'web', from: 'develop' });
    else throw new Error('expected ok parse');
  });

  it('detects --help', () => {
    const r = parseArgs(z.object({ app: z.string() }), ['--help']);
    expect(r.help).toBeTruthy();
  });

  it('reports a validation failure for a missing required field', () => {
    const r = parseArgs(z.object({ app: z.string() }), []);
    if (!r.help) {
      expect(r.ok).toBeFalsy();
      if (!r.ok) expect(r.error).toMatch(/app/);
    } else {
      throw new Error('expected non-help result');
    }
  });
});
