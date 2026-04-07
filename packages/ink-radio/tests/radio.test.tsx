import React from 'react';
import { render } from 'ink-testing-library';
import { describe, it, expect } from 'vitest';

import { RadioGroup } from '../src/radio.js';

const options = [
  { label: 'Apple', value: 'apple' },
  { label: 'Banana', value: 'banana' },
  { label: 'Cherry', value: 'cherry' },
];

describe('RadioGroup', () => {
  it('renders all options', () => {
    const { lastFrame } = render(<RadioGroup options={options} />);
    const frame = lastFrame()!;
    expect(frame).toContain('Apple');
    expect(frame).toContain('Banana');
    expect(frame).toContain('Cherry');
  });

  it('highlights selected option', () => {
    const { lastFrame } = render(<RadioGroup options={options} value="banana" />);
    const frame = lastFrame()!;
    expect(frame).toContain('\u25C9 Banana');
    expect(frame).toContain('\u25CB Apple');
    expect(frame).toContain('\u25CB Cherry');
  });

  it('shows disabled options as dim', () => {
    const disabledOptions = [
      { label: 'Apple', value: 'apple' },
      { label: 'Banana', value: 'banana', disabled: true },
    ];
    const { lastFrame } = render(<RadioGroup options={disabledOptions} />);
    const frame = lastFrame()!;
    expect(frame).toContain('Apple');
    expect(frame).toContain('Banana');
  });

  it('renders horizontal layout', () => {
    const { lastFrame } = render(<RadioGroup options={options} direction="horizontal" />);
    const frame = lastFrame()!;
    // in horizontal mode, all options should be on the same line
    const lines = frame.split('\n').filter((l) => l.trim().length > 0);
    expect(lines.length).toBe(1);
    expect(lines[0]).toContain('Apple');
    expect(lines[0]).toContain('Banana');
    expect(lines[0]).toContain('Cherry');
  });

  it('renders with custom color and selected value', () => {
    const { lastFrame } = render(<RadioGroup options={options} value="apple" color="green" />);
    const frame = lastFrame()!;
    expect(frame).toContain('\u25C9 Apple');
    expect(frame).toContain('Banana');
    expect(frame).toContain('Cherry');
  });
});
