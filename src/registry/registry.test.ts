import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { z } from 'zod';

import { register, getCommand, allCommands, _resetRegistry } from './registry';
import type { CommandDef } from './types';

const fake: CommandDef = {
  name: 'demo',
  summary: 'a demo command',
  args: z.object({}),
  async run() {
    return { ok: true, summary: 'done', data: null };
  },
};

describe('command registry', () => {
  beforeEach(() => _resetRegistry());
  afterEach(() => _resetRegistry());

  it('registers and retrieves a command', () => {
    register(fake);
    expect(getCommand('demo')).toBe(fake);
  });

  it('throws on duplicate registration', () => {
    register(fake);
    expect(() => register(fake)).toThrow(/duplicate/);
  });

  it('lists all commands sorted by name', () => {
    register({ ...fake, name: 'zebra' });
    register({ ...fake, name: 'alpha' });
    expect(allCommands().map(c => c.name)).toEqual(['alpha', 'zebra']);
  });

  it('returns undefined for an unknown command', () => {
    expect(getCommand('nope')).toBeUndefined();
  });
});
