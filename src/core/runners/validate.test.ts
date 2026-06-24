import { describe, expect, it } from 'vitest';

import { assertDestination, isValidHost, validateHost } from './validate';

describe('assertDestination', () => {
  it('accepts user@host and bare aliases', () => {
    expect(() => assertDestination('matt@box')).not.toThrow();
    expect(() => assertDestination('mac-mini')).not.toThrow();
    expect(() => assertDestination('build.host_1')).not.toThrow();
  });

  it('rejects an ssh-flag-injecting destination', () => {
    // the SEC-H1 payload class: a destination ssh would parse as options.
    expect(() => assertDestination('-oProxyCommand=touch /tmp/pwned')).toThrow();
    expect(() => assertDestination('-oPermitLocalCommand=yes')).toThrow();
    expect(() => assertDestination('-i/tmp/evil')).toThrow();
  });

  it('rejects destinations with shell or path metacharacters', () => {
    expect(() => assertDestination('host; rm -rf /')).toThrow();
    expect(() => assertDestination('host/../../etc')).toThrow();
    expect(() => assertDestination('a b')).toThrow();
    expect(() => assertDestination('')).toThrow();
  });
});

describe('validateHost / isValidHost', () => {
  it('accepts a well-formed host', () => {
    expect(isValidHost({ destination: 'matt@box', port: 22, identityFile: '/k/id', defaultCwd: '/srv' })).toBe(true);
  });

  it('rejects a leading-dash identity file or cwd', () => {
    expect(isValidHost({ destination: 'matt@box', identityFile: '-oProxyCommand=x' })).toBe(false);
    expect(isValidHost({ destination: 'matt@box', defaultCwd: '-x' })).toBe(false);
  });

  it('rejects an out-of-range port and a missing destination', () => {
    expect(isValidHost({ destination: 'matt@box', port: 0 })).toBe(false);
    expect(isValidHost({ destination: 'matt@box', port: 70000 })).toBe(false);
    // @ts-expect-error intentionally malformed
    expect(isValidHost({})).toBe(false);
  });

  it('throws with a descriptive message via validateHost', () => {
    expect(() => validateHost({ destination: '-bad' })).toThrow(/must not start with/);
  });
});
