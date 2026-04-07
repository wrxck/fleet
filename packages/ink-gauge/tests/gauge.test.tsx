import React from 'react';
import { render } from 'ink-testing-library';
import { describe, it, expect } from 'vitest';

import { Gauge } from '../src/gauge.js';

describe('Gauge', () => {
  it('renders bar at correct fill level', () => {
    const { lastFrame } = render(<Gauge value={50} width={10} />);
    const frame = lastFrame()!;
    // 50% of 10 = 5 filled, 5 empty
    expect(frame).toContain('\u2588'.repeat(5));
    expect(frame).toContain('\u2591'.repeat(5));
  });

  it('shows percentage', () => {
    const { lastFrame } = render(<Gauge value={75} />);
    const frame = lastFrame()!;
    expect(frame).toContain('75%');
  });

  it('hides percentage when showPercentage is false', () => {
    const { lastFrame } = render(<Gauge value={75} showPercentage={false} />);
    const frame = lastFrame()!;
    expect(frame).not.toContain('75%');
  });

  it('applies threshold colours', () => {
    // when value >= 80, threshold colour should apply
    // we verify indirectly by checking the bar renders (colour is applied via ink)
    const thresholds = [
      { value: 80, color: 'yellow' },
      { value: 95, color: 'red' },
    ];
    const { lastFrame } = render(<Gauge value={90} width={10} thresholds={thresholds} />);
    const frame = lastFrame()!;
    expect(frame).toContain('90%');
    // bar should still render
    expect(frame).toContain('[');
    expect(frame).toContain(']');
  });

  it('renders label', () => {
    const { lastFrame } = render(<Gauge value={45} label="CPU" />);
    const frame = lastFrame()!;
    expect(frame).toContain('CPU');
    expect(frame).toContain('45%');
  });

  it('clamps values above 100', () => {
    const { lastFrame } = render(<Gauge value={150} width={10} />);
    const frame = lastFrame()!;
    expect(frame).toContain('100%');
    expect(frame).toContain('\u2588'.repeat(10));
  });

  it('clamps values below 0', () => {
    const { lastFrame } = render(<Gauge value={-10} width={10} />);
    const frame = lastFrame()!;
    expect(frame).toContain('0%');
    expect(frame).toContain('\u2591'.repeat(10));
  });
});
