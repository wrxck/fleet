import { describe, it, expect } from 'vitest';

import { formatDuration, formatRelative, formatUsd, truncate } from './format.js';

describe('format helpers', () => {
  it('formatRelative returns em-dash for null', () => {
    expect(formatRelative(null)).toBe('—');
  });

  it('formatRelative handles seconds, minutes, hours, days', () => {
    const now = Date.now();
    expect(formatRelative(new Date(now - 30_000).toISOString(), now)).toBe('30s ago');
    expect(formatRelative(new Date(now - 5 * 60_000).toISOString(), now)).toBe('5m ago');
    expect(formatRelative(new Date(now - 2 * 3_600_000).toISOString(), now)).toBe('2h ago');
    expect(formatRelative(new Date(now - 3 * 86_400_000).toISOString(), now)).toBe('3d ago');
  });

  it('formatRelative says "just now" for under 10s', () => {
    expect(formatRelative(new Date(Date.now() - 500).toISOString())).toBe('just now');
  });

  it('formatDuration handles ms, seconds, minutes', () => {
    expect(formatDuration(null)).toBe('—');
    expect(formatDuration(250)).toBe('250ms');
    expect(formatDuration(3_500)).toBe('3.5s');
    expect(formatDuration(90_500)).toBe('1m 31s');
  });

  it('formatUsd handles null, small, mid, large amounts', () => {
    expect(formatUsd(null)).toBe('—');
    expect(formatUsd(0.003)).toBe('<$0.01');
    expect(formatUsd(0.25)).toBe('$0.250');
    expect(formatUsd(12.5)).toBe('$12.50');
  });

  it('truncate adds ellipsis when over max', () => {
    expect(truncate('hello world', 8)).toBe('hello w…');
    expect(truncate('short', 10)).toBe('short');
  });
});
