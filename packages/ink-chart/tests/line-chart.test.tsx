import React from 'react';
import { render } from 'ink-testing-library';
import { describe, it, expect } from 'vitest';

import { LineChart } from '../src/line-chart.js';

describe('LineChart', () => {
  it('renders a chart', () => {
    const { lastFrame } = render(<LineChart data={[1, 3, 2, 5, 4]} width={20} height={5} />);
    expect(lastFrame()).toBeTruthy();
    expect(lastFrame()!.split('\n').length).toBeGreaterThanOrEqual(3);
  });

  it('renders with showAxis=false', () => {
    const { lastFrame } = render(<LineChart data={[1, 2, 3]} width={10} height={5} showAxis={false} />);
    const frame = lastFrame()!;
    // should not contain axis scale numbers at the start of lines
    expect(frame).toBeTruthy();
  });

  it('renders with label', () => {
    const { lastFrame } = render(<LineChart data={[1, 2, 3]} width={10} height={5} label="CPU" />);
    expect(lastFrame()).toContain('CPU');
  });

  it('handles single data point', () => {
    const { lastFrame } = render(<LineChart data={[5]} width={10} height={5} />);
    expect(lastFrame()).toBeTruthy();
  });

  it('handles empty data', () => {
    const { lastFrame } = render(<LineChart data={[]} width={10} height={5} />);
    expect(lastFrame()).toBeDefined();
  });
});
