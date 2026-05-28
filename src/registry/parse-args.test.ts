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

  it('rejects an unknown flag', () => {
    const r = parseArgs(z.object({ app: z.string() }), ['web', '--bogus', 'x']);
    if (!r.help) {
      expect(r.ok).toBeFalsy();
      if (!r.ok) expect(r.error).toMatch(/unknown flag/);
    } else {
      throw new Error('expected non-help result');
    }
  });

  it('rejects a trailing flag with no value', () => {
    const r = parseArgs(z.object({ app: z.string(), from: z.string().optional() }), ['web', '--from']);
    if (!r.help) {
      expect(r.ok).toBeFalsy();
      if (!r.ok) expect(r.error).toMatch(/--from requires a value/);
    } else {
      throw new Error('expected non-help result');
    }
  });

  it('supports the --key=value form', () => {
    const r = parseArgs(z.object({ app: z.string(), from: z.string().optional() }), ['web', '--from=develop']);
    if (!r.help && r.ok) {
      expect(r.values).toEqual({ app: 'web', from: 'develop' });
    } else {
      throw new Error('expected ok parse');
    }
  });

  it('resolves the -y short flag to the yes field without consuming a positional', () => {
    const schema = z.object({ app: z.string(), yes: z.boolean().default(false) });
    const r = parseArgs(schema, ['-y', 'web']);
    if (!r.help && r.ok) {
      expect(r.values).toEqual({ app: 'web', yes: true });
    } else {
      throw new Error('expected ok parse');
    }
  });

  it('rejects a short flag with no matching schema field', () => {
    const r = parseArgs(z.object({ app: z.string() }), ['web', '-y']);
    if (!r.help) {
      expect(r.ok).toBeFalsy();
      if (!r.ok) expect(r.error).toMatch(/unknown flag: -y/);
    } else {
      throw new Error('expected non-help result');
    }
  });

  it('rejects an unrecognised short flag', () => {
    const schema = z.object({ app: z.string(), yes: z.boolean().default(false) });
    const r = parseArgs(schema, ['web', '-z']);
    if (!r.help) {
      expect(r.ok).toBeFalsy();
      if (!r.ok) expect(r.error).toMatch(/unknown flag: -z/);
    } else {
      throw new Error('expected non-help result');
    }
  });
});
