import { describe, it, expect, afterEach } from 'vitest';

import { requireEnv } from './env';

const KEY = 'FLEET_TEST_REQUIRE_ENV';

describe('requireEnv', () => {
  afterEach(() => { delete process.env[KEY]; });

  it('returns the value when the variable is set', () => {
    process.env[KEY] = '/some/path';
    expect(requireEnv(KEY)).toBe('/some/path');
  });

  it('throws a FleetError naming the variable when unset', () => {
    delete process.env[KEY];
    expect(() => requireEnv(KEY)).toThrowError(/FLEET_TEST_REQUIRE_ENV/);
  });

  it('throws when the variable is set but empty', () => {
    process.env[KEY] = '';
    expect(() => requireEnv(KEY)).toThrowError(/FLEET_TEST_REQUIRE_ENV/);
  });
});
