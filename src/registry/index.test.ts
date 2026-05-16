import { describe, it, expect } from 'vitest';

import { loadRegistry } from './index';
import { allCommands } from './registry';

describe('registry assembly', () => {
  it('loadRegistry does not throw', () => {
    expect(() => loadRegistry()).not.toThrow();
  });

  it('is idempotent — repeated calls do not throw', () => {
    loadRegistry();
    loadRegistry();
    expect(() => loadRegistry()).not.toThrow();
  });

  it('exposes the registered commands via allCommands', () => {
    loadRegistry();
    // the command list is empty at this stage; later tasks populate it.
    expect(Array.isArray(allCommands())).toBe(true);
  });
});
