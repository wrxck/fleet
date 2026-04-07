import React from 'react';
import { render } from 'ink-testing-library';
import { describe, it, expect } from 'vitest';

import { Switch } from '../src/switch.js';

describe('Switch', () => {
  it('renders on state', () => {
    const { lastFrame } = render(<Switch value={true} />);
    const frame = lastFrame()!;
    expect(frame).toContain('(*)--');
    expect(frame).toContain('ON');
  });

  it('renders off state', () => {
    const { lastFrame } = render(<Switch value={false} />);
    const frame = lastFrame()!;
    expect(frame).toContain('--(*)');
    expect(frame).toContain('OFF');
  });

  it('shows label', () => {
    const { lastFrame } = render(<Switch value={true} label="Wi-Fi" />);
    const frame = lastFrame()!;
    expect(frame).toContain('Wi-Fi');
    expect(frame).toContain('ON');
  });

  it('renders disabled', () => {
    const { lastFrame } = render(<Switch value={true} disabled />);
    const frame = lastFrame()!;
    expect(frame).toContain('(*)--');
    expect(frame).toContain('ON');
  });
});
