import React from 'react';
import { render } from 'ink-testing-library';
import { describe, it, expect } from 'vitest';

import { Rule } from '../src/rule.js';

const LINE_CHAR = '\u2500';

describe('Rule', () => {
  it('renders a horizontal line', () => {
    const { lastFrame } = render(<Rule width={20} />);
    const frame = lastFrame()!;
    expect(frame).toBe(LINE_CHAR.repeat(20));
  });

  it('renders with title centred', () => {
    const { lastFrame } = render(<Rule title="hello" width={20} />);
    const frame = lastFrame()!;
    expect(frame).toContain(' hello ');
    expect([...frame]).toHaveLength(20);
    expect(frame.startsWith(LINE_CHAR)).toBe(true);
    expect(frame.endsWith(LINE_CHAR)).toBe(true);
  });

  it('respects custom char', () => {
    const { lastFrame } = render(<Rule char="=" width={10} />);
    const frame = lastFrame()!;
    expect(frame).toBe('='.repeat(10));
  });

  it('renders with custom color', () => {
    const { lastFrame } = render(<Rule color="red" width={20} />);
    const frame = lastFrame()!;
    expect(frame).toContain(LINE_CHAR);
  });

  it('handles title longer than width without crashing', () => {
    const { lastFrame } = render(<Rule title="Very Long Title Here" width={10} />);
    const frame = lastFrame()!;
    expect(frame).toBeDefined();
  });
});
