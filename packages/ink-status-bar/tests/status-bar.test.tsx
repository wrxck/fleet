import React from 'react';
import { render } from 'ink-testing-library';
import { Text } from 'ink';
import { describe, it, expect, beforeEach } from 'vitest';

import { StatusBar } from '../src/status-bar.js';

describe('StatusBar', () => {
  beforeEach(() => {
    Object.defineProperty(process.stdout, 'columns', {
      value: 80,
      writable: true,
      configurable: true,
    });
  });

  it('renders key hints', () => {
    const items = [
      { key: 'q', label: 'quit' },
      { key: 'Tab', label: 'switch view' },
    ];
    const { lastFrame } = render(<StatusBar items={items} />);
    const frame = lastFrame()!;
    expect(frame).toContain('[q]');
    expect(frame).toContain('quit');
    expect(frame).toContain('[Tab]');
    expect(frame).toContain('switch view');
  });

  it('renders left/center/right slots', () => {
    const { lastFrame } = render(
      <StatusBar
        left={<Text>INSERT</Text>}
        center={<Text>file.ts</Text>}
        right={<Text>3/10</Text>}
      />
    );
    const frame = lastFrame()!;
    expect(frame).toContain('INSERT');
    expect(frame).toContain('file.ts');
    expect(frame).toContain('3/10');
  });

  it('renders with custom background colour', () => {
    const items = [{ key: 'h', label: 'help' }];
    const { lastFrame } = render(
      <StatusBar items={items} backgroundColor="blue" color="yellow" />
    );
    const frame = lastFrame()!;
    expect(frame).toContain('[h]');
    expect(frame).toContain('help');
  });
});
