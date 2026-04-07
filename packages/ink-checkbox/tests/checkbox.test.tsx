import React from 'react';
import { render } from 'ink-testing-library';
import { describe, it, expect } from 'vitest';

import { Checkbox } from '../src/checkbox.js';

const CHECKED_ICON = '\u2611';
const UNCHECKED_ICON = '\u2610';

describe('Checkbox', () => {
  it('renders checked state', () => {
    const { lastFrame } = render(<Checkbox label="Enable" checked={true} />);
    const frame = lastFrame()!;
    expect(frame).toContain(CHECKED_ICON);
    expect(frame).toContain('Enable');
  });

  it('renders unchecked state', () => {
    const { lastFrame } = render(<Checkbox label="Enable" checked={false} />);
    const frame = lastFrame()!;
    expect(frame).toContain(UNCHECKED_ICON);
    expect(frame).toContain('Enable');
  });

  it('renders disabled', () => {
    const { lastFrame } = render(<Checkbox label="Locked" checked={false} disabled={true} />);
    const frame = lastFrame()!;
    expect(frame).toContain(UNCHECKED_ICON);
    expect(frame).toContain('Locked');
  });
});
