import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { loadRegistry, _resetLoader } from './index';
import { allCommands, getCommand } from './registry';

describe('registry assembly', () => {
  beforeEach(() => _resetLoader());
  afterEach(() => _resetLoader());

  it('registers all commands in ALL without throwing', () => {
    loadRegistry();
    expect(allCommands().length).toBeGreaterThanOrEqual(2);
    expect(getCommand('status')?.name).toBe('status');
    expect(getCommand('list')?.name).toBe('list');
  });

  it('is idempotent — repeated calls do not throw', () => {
    loadRegistry();
    loadRegistry();
    expect(() => loadRegistry()).not.toThrow();
  });

  it('exposes the registered commands via allCommands', () => {
    loadRegistry();
    expect(Array.isArray(allCommands())).toBeTruthy();
  });
});
