import { describe, it, expect } from 'vitest';

import { timerUnitName, serviceUnitName } from './schedule';

describe('backup/schedule', () => {
  it('builds the timer unit name for an app', () => {
    expect(timerUnitName('demo-shop')).toBe('fleet-backup@demo-shop.timer');
    expect(serviceUnitName('demo-shop')).toBe('fleet-backup@demo-shop.service');
  });

  it('handles pseudo-app names with hyphens', () => {
    expect(timerUnitName('root-home')).toBe('fleet-backup@root-home.timer');
    expect(serviceUnitName('user-home')).toBe('fleet-backup@user-home.service');
  });
});
