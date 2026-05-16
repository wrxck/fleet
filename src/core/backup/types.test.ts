import { describe, it, expect } from 'vitest';

import { isPseudoApp, PSEUDO_APPS } from './types';

describe('isPseudoApp', () => {
  it('returns true for the three pseudo apps', () => {
    for (const name of PSEUDO_APPS) {
      expect(isPseudoApp(name)).toBe(true);
    }
  });

  it('returns false for normal apps', () => {
    for (const name of ['demo-shop', 'petcare', 'art-store-ui']) {
      expect(isPseudoApp(name)).toBe(false);
    }
  });
});
