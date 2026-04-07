import { describe, it, expect } from 'vitest';
import React from 'react';

import { render } from 'ink-testing-library';

import { Sparkline } from '../src/sparkline.js';
import { BLOCKS } from '../src/chars.js';

describe('Sparkline', () => {
  it('renders block characters for data', () => {
    const { lastFrame } = render(<Sparkline data={[0, 1, 2, 3, 4, 5, 6, 7]} />);
    const frame = lastFrame()!;
    expect(frame).toContain(BLOCKS[0]);
    expect(frame).toContain(BLOCKS[7]);
  });

  it('handles empty data', () => {
    const { lastFrame } = render(<Sparkline data={[]} />);
    expect(lastFrame()).toBe('');
  });

  it('respects min/max props', () => {
    const { lastFrame } = render(<Sparkline data={[5, 5, 5]} min={0} max={10} />);
    const frame = lastFrame()!;
    // value 5 out of 0-10 range = 0.5 -> level ~4
    expect(frame).toContain(BLOCKS[4]);
  });

  it('handles single value', () => {
    const { lastFrame } = render(<Sparkline data={[42]} />);
    const frame = lastFrame()!;
    // with single value, range=0, should render mid block
    expect(frame.length).toBeGreaterThan(0);
  });

  it('respects width prop', () => {
    const { lastFrame } = render(<Sparkline data={[1, 2, 3, 4, 5]} width={3} />);
    const frame = lastFrame()!;
    // should have 3 block characters
    const blocks = frame.replace(/\s/g, '');
    expect(blocks.length).toBe(3);
  });
});
