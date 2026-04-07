import React from 'react';
import { render } from 'ink-testing-library';
import { Text } from 'ink';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { useTerminalSize } from '../src/use-terminal-size.js';

function SizeDisplay(): React.JSX.Element {
  const { rows, columns } = useTerminalSize();
  return <Text>{`${columns}x${rows}`}</Text>;
}

describe('useTerminalSize', () => {
  const originalColumns = process.stdout.columns;
  const originalRows = process.stdout.rows;

  beforeEach(() => {
    Object.defineProperty(process.stdout, 'columns', { value: 80, writable: true, configurable: true });
    Object.defineProperty(process.stdout, 'rows', { value: 24, writable: true, configurable: true });
  });

  afterEach(() => {
    Object.defineProperty(process.stdout, 'columns', { value: originalColumns, writable: true, configurable: true });
    Object.defineProperty(process.stdout, 'rows', { value: originalRows, writable: true, configurable: true });
  });

  it('returns current terminal dimensions', () => {
    const { lastFrame } = render(<SizeDisplay />);
    expect(lastFrame()).toContain('80x24');
  });
});
