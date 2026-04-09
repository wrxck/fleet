import { describe, it, expect } from 'vitest';
import React from 'react';

import { render } from 'ink-testing-library';

import { BarChart } from '../src/bar-chart.js';
import { FULL_BLOCK } from '../src/chars.js';

describe('BarChart', () => {
  it('renders bars', () => {
    const { lastFrame } = render(
      <BarChart
        data={[
          { label: 'A', value: 10 },
          { label: 'B', value: 5 },
        ]}
        height={5}
      />,
    );
    const frame = lastFrame()!;
    expect(frame).toContain(FULL_BLOCK);
  });

  it('shows labels', () => {
    const { lastFrame } = render(
      <BarChart
        data={[
          { label: 'Foo', value: 10 },
          { label: 'Bar', value: 5 },
        ]}
      />,
    );
    const frame = lastFrame()!;
    expect(frame).toContain('Foo');
    expect(frame).toContain('Bar');
  });

  it('shows values when showValues is true', () => {
    const { lastFrame } = render(
      <BarChart
        data={[
          { label: 'A', value: 42 },
          { label: 'B', value: 7 },
        ]}
        showValues={true}
      />,
    );
    const frame = lastFrame()!;
    expect(frame).toContain('42');
    expect(frame).toContain('7');
  });

  it('hides values when showValues is false', () => {
    const { lastFrame } = render(
      <BarChart
        data={[
          { label: 'A', value: 42 },
        ]}
        showValues={false}
      />,
    );
    const frame = lastFrame()!;
    expect(frame).not.toContain('42');
  });

  it('handles empty data', () => {
    const { lastFrame } = render(<BarChart data={[]} />);
    expect(lastFrame()).toBe('');
  });

  it('respects custom height prop', () => {
    const { lastFrame } = render(
      <BarChart
        data={[
          { label: 'A', value: 10 },
          { label: 'B', value: 5 },
        ]}
        height={5}
      />,
    );
    const frame = lastFrame()!;
    // bars portion (lines containing block chars) should be at most 5 lines
    const barLines = frame.split('\n').filter((l) => l.includes(FULL_BLOCK));
    expect(barLines.length).toBeLessThanOrEqual(5);
  });
});
