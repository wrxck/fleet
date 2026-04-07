import React from 'react';
import { render } from 'ink-testing-library';
import { describe, it, expect } from 'vitest';

import { LogViewer, type LogLine } from '../src/log-viewer.js';

function makeLines(count: number): LogLine[] {
  return Array.from({ length: count }, (_, i) => ({
    text: `Line ${i}`,
    timestamp: new Date(2026, 0, 1, 12, 30, i % 60),
    level: (['info', 'warn', 'error', 'debug'] as const)[i % 4],
  }));
}

describe('LogViewer', () => {
  it('renders log lines', () => {
    const lines = makeLines(3);
    const { lastFrame } = render(
      <LogViewer lines={lines} height={5} />
    );
    const frame = lastFrame()!;
    expect(frame).toContain('Line 0');
    expect(frame).toContain('Line 1');
    expect(frame).toContain('Line 2');
  });

  it('shows timestamps when enabled', () => {
    const lines: LogLine[] = [
      { text: 'hello', timestamp: new Date(2026, 0, 1, 9, 5, 3) },
    ];
    const { lastFrame } = render(
      <LogViewer lines={lines} height={5} showTimestamps />
    );
    expect(lastFrame()).toContain('09:05:03');
  });

  it('shows level badges', () => {
    const lines: LogLine[] = [
      { text: 'info msg', level: 'info' },
      { text: 'warn msg', level: 'warn' },
      { text: 'error msg', level: 'error' },
      { text: 'debug msg', level: 'debug' },
    ];
    const { lastFrame } = render(
      <LogViewer lines={lines} height={10} showLevel />
    );
    const frame = lastFrame()!;
    expect(frame).toContain('INFO');
    expect(frame).toContain('WARN');
    expect(frame).toContain('ERR');
    expect(frame).toContain('DBG');
  });

  it('filters lines case-insensitively', () => {
    const lines: LogLine[] = [
      { text: 'Starting server' },
      { text: 'Error occurred' },
      { text: 'Server ready' },
    ];
    const { lastFrame } = render(
      <LogViewer lines={lines} height={10} filter="server" />
    );
    const frame = lastFrame()!;
    expect(frame).toContain('Starting server');
    expect(frame).toContain('Server ready');
    expect(frame).not.toContain('Error occurred');
  });

  it('auto-scrolls to bottom showing last height lines', () => {
    const lines = makeLines(20);
    const { lastFrame } = render(
      <LogViewer lines={lines} height={5} />
    );
    const frame = lastFrame()!;
    expect(frame).toContain('Line 19');
    expect(frame).toContain('Line 15');
    expect(frame).not.toContain('Line 14');
  });

  it('shows from top when fewer lines than height', () => {
    const lines = makeLines(2);
    const { lastFrame } = render(
      <LogViewer lines={lines} height={10} />
    );
    const frame = lastFrame()!;
    expect(frame).toContain('Line 0');
    expect(frame).toContain('Line 1');
  });

  it('shows from top when autoScroll is false', () => {
    const lines = makeLines(20);
    const { lastFrame } = render(
      <LogViewer lines={lines} height={5} autoScroll={false} />
    );
    const frame = lastFrame()!;
    expect(frame).toContain('Line 0');
    expect(frame).toContain('Line 4');
    expect(frame).not.toContain('Line 5');
  });
});
