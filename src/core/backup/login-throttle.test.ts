import { describe, it, expect } from 'vitest';

import { createLoginThrottle } from './login-throttle';

describe('createLoginThrottle', () => {
  it('allows up to capacity attempts then blocks', () => {
    const t = createLoginThrottle({ capacity: 3, windowMs: 60_000 });
    expect(t.take(0)).toBe(true);
    expect(t.take(0)).toBe(true);
    expect(t.take(0)).toBe(true);
    expect(t.take(0)).toBe(false);
  });

  it('refills linearly over the window', () => {
    const t = createLoginThrottle({ capacity: 4, windowMs: 60_000 });
    for (let i = 0; i < 4; i++) t.take(0);
    expect(t.take(0)).toBe(false);
    // a quarter window restores ~1 token
    expect(t.take(15_000)).toBe(true);
    expect(t.take(15_000)).toBe(false);
  });

  it('never exceeds capacity when idle for a long time', () => {
    const t = createLoginThrottle({ capacity: 2, windowMs: 1_000 });
    t.take(0);
    // huge idle gap shouldn't grant more than `capacity` attempts
    expect(t.take(10_000_000)).toBe(true);
    expect(t.take(10_000_000)).toBe(true);
    expect(t.take(10_000_000)).toBe(false);
  });

  it('refund returns a consumed token but never exceeds capacity', () => {
    const t = createLoginThrottle({ capacity: 2, windowMs: 60_000 });
    expect(t.take(0)).toBe(true);
    expect(t.take(0)).toBe(true);
    expect(t.take(0)).toBe(false);
    // three refunds against capacity 2 — only two are restored.
    t.refund();
    t.refund();
    t.refund();
    expect(t.take(0)).toBe(true);
    expect(t.take(0)).toBe(true);
    expect(t.take(0)).toBe(false);
  });
});
