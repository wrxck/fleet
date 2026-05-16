import { describe, it, expect } from 'vitest';

import { defaultScheduleFor } from './detect';

describe('backup/detect', () => {
  it('apps with a db dump default to hourly', () => {
    expect(defaultScheduleFor(true)).toBe('hourly');
  });
  it('apps without a db default to daily', () => {
    expect(defaultScheduleFor(false)).toBe('daily');
  });
});
