import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { loadRegistry, _resetLoader } from './index';
import { allCommands } from './registry';

describe('registry assembly', () => {
  beforeEach(() => _resetLoader());
  afterEach(() => _resetLoader());

  it('registers all commands in ALL without throwing', () => {
    loadRegistry();
    // ALL is intentionally empty at this stage; later tasks populate it.
    expect(allCommands()).toHaveLength(0);
  });

  it('is idempotent — repeated calls do not throw', () => {
    loadRegistry();
    loadRegistry();
    expect(() => loadRegistry()).not.toThrow();
  });

  it('exposes the registered commands via allCommands', () => {
    loadRegistry();
    expect(Array.isArray(allCommands())).toBe(true);
  });
});
