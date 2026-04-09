import React from 'react';
import { render } from 'ink-testing-library';
import { describe, it, expect } from 'vitest';

import { Donut } from '../src/donut.js';

describe('Donut', () => {
  it('renders percentage in small mode', () => {
    const { lastFrame } = render(<Donut value={40} />);
    const frame = lastFrame()!;
    expect(frame).toContain('40%');
  });

  it('renders in small mode with filled/empty circles', () => {
    const { lastFrame } = render(<Donut value={50} />);
    const frame = lastFrame()!;
    // 50% of 10 = 5 filled circles, 5 empty
    expect(frame).toContain('\u25CF'.repeat(5));
    expect(frame).toContain('\u25CB'.repeat(5));
    expect(frame).toContain('[');
    expect(frame).toContain(']');
  });

  it('renders custom label in small mode', () => {
    const { lastFrame } = render(<Donut value={40} label="CPU 40%" />);
    const frame = lastFrame()!;
    expect(frame).toContain('CPU 40%');
  });

  it('renders in large mode with box', () => {
    const { lastFrame } = render(<Donut value={75} size="large" />);
    const frame = lastFrame()!;
    expect(frame).toContain('75%');
    expect(frame).toContain('\u256D');
    expect(frame).toContain('\u256E');
    expect(frame).toContain('\u2502');
    expect(frame).toContain('\u2570');
    expect(frame).toContain('\u256F');
  });

  it('clamps value to 0-100', () => {
    const { lastFrame } = render(<Donut value={200} />);
    const frame = lastFrame()!;
    expect(frame).toContain('100%');
  });
});
