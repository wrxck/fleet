import { describe, expect, it, vi } from 'vitest';

import { guardCommand } from './guard.js';

// the guard command intentionally does very little in-process — every
// non-install verb is a passthrough to /usr/local/sbin/fleet-guard, which
// only exists on a fully installed host. these tests cover the in-process
// help and error paths only; passthrough integration is exercised by the
// host cli.

describe('guardCommand', () => {
  it('returns without throwing when called without args', () => {
    expect(() => guardCommand([])).not.toThrow();
  });

  it('returns without throwing on --help', () => {
    expect(() => guardCommand(['--help'])).not.toThrow();
  });

  it('exits 2 on unknown subcommand', () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('exit');
    });
    expect(() => guardCommand(['bogus'])).toThrow('exit');
    expect(exitSpy).toHaveBeenCalledWith(2);
    exitSpy.mockRestore();
  });
});
