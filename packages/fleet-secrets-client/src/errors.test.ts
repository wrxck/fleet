import { describe, it, expect } from 'vitest';

import { FleetSecretsError } from './errors.js';

describe('FleetSecretsError', () => {
  it('constructs with message and default code', () => {
    const err = new FleetSecretsError('something went wrong');
    expect(err.message).toBe('something went wrong');
    expect(err.code).toBe('fleet_secrets_error');
    expect(err.name).toBe('FleetSecretsError');
  });

  it('constructs with custom code', () => {
    const err = new FleetSecretsError('timed out', 'timeout');
    expect(err.message).toBe('timed out');
    expect(err.code).toBe('timeout');
  });

  it('is instanceof both Error and FleetSecretsError', () => {
    const err = new FleetSecretsError('test');
    expect(err instanceof Error).toBeTruthy();
    expect(err instanceof FleetSecretsError).toBeTruthy();
  });
});
