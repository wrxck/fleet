import { describe, it, expect } from 'vitest';

import { timerUnitName, serviceUnitName } from './schedule';

describe('backup/schedule', () => {
  it('builds the timer unit name for an app', () => {
    expect(timerUnitName('shotzandpotz')).toBe('fleet-backup@shotzandpotz.timer');
    expect(serviceUnitName('shotzandpotz')).toBe('fleet-backup@shotzandpotz.service');
  });

  it('handles pseudo-app names with hyphens', () => {
    expect(timerUnitName('root-home')).toBe('fleet-backup@root-home.timer');
    expect(serviceUnitName('user-home')).toBe('fleet-backup@user-home.service');
  });
});
