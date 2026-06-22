import { describe, it, expect } from 'vitest';

import { TOOL_TIERS, tierOf, isUnmapped } from './tiers';

describe('tool tiers', () => {
  it('classifies decrypted-value reads as the deny-by-default `secret` tier', () => {
    // fleet_secrets_get returns a plaintext secret value — it must NOT be a
    // freely-allowed `read`, otherwise a compromised client bulk-exfiltrates.
    expect(TOOL_TIERS.fleet_secrets_get).toBe('secret');
  });

  it('keeps masked / metadata secret tools on the `read` tier', () => {
    expect(TOOL_TIERS.fleet_secrets_list).toBe('read');
    expect(TOOL_TIERS.fleet_secrets_status).toBe('read');
    expect(TOOL_TIERS.fleet_secrets_drift).toBe('read');
    expect(TOOL_TIERS.fleet_secrets_validate).toBe('read');
  });

  it('fails closed to destructive for unmapped tools', () => {
    expect(tierOf('fleet_some_new_tool')).toBe('destructive');
    expect(isUnmapped('fleet_some_new_tool')).toBe(true);
    expect(isUnmapped('fleet_secrets_get')).toBe(false);
  });
});
