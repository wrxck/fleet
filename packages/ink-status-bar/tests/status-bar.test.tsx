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

  it('renders without key hints when items is empty', () => {
    const { lastFrame } = render(<StatusBar items={[]} />);
    const frame = lastFrame()!;
    expect(frame).not.toMatch(/\[.*\]/);
  });

  it('renders right slot only', () => {
    const { lastFrame } = render(
      <StatusBar right={<Text>right-content</Text>} />
    );
    const frame = lastFrame()!;
    expect(frame).toContain('right-content');
  });

  it('renders both left slot and items together', () => {
    const items = [{ key: 'j', label: 'down' }];
    const { lastFrame } = render(
      <StatusBar left={<Text>MODE</Text>} items={items} />
    );
    const frame = lastFrame()!;
    expect(frame).toContain('MODE');
    expect(frame).toContain('[j]');
    expect(frame).toContain('down');
  });
});
