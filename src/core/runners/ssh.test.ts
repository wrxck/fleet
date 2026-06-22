import { describe, expect, it } from 'vitest';

import { shquote, sshConnectFlags } from './ssh';

describe('shquote', () => {
  it('wraps a plain token in single quotes', () => {
    expect(shquote('node')).toBe("'node'");
  });

  it('escapes embedded single quotes so the token cannot break out', () => {
    expect(shquote("it's")).toBe("'it'\\''s'");
  });

  it('keeps spaces inside one quoted token', () => {
    expect(shquote('a b')).toBe("'a b'");
  });
});

describe('sshConnectFlags', () => {
  it('always sets batch mode and a connect timeout', () => {
    expect(sshConnectFlags({ destination: 'd' })).toEqual(['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10']);
  });

  it('adds port and identity when present', () => {
    expect(sshConnectFlags({ destination: 'd', port: 2222, identityFile: '/k' })).toEqual([
      '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', '-p', '2222', '-i', '/k',
    ]);
  });
});
