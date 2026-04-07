import React from 'react';
import { render } from 'ink-testing-library';
import { describe, it, expect } from 'vitest';

import { Timeline } from '../src/timeline.js';
import type { TimelineEvent } from '../src/timeline.js';

const CHAR_DOT = String.fromCodePoint(0x25CF);
const CHAR_PIPE = String.fromCodePoint(0x2502);
const CHAR_ARROW_DOWN = String.fromCodePoint(0x25BC);

describe('Timeline', () => {
  const sampleEvents: TimelineEvent[] = [
    { time: '10:00', title: 'First deploy', type: 'deploy' },
    { time: '10:15', title: 'Service restart', type: 'restart' },
    { time: '10:30', title: 'Alert fired', type: 'alert', description: 'CPU usage above 90%' },
  ];

  it('renders events with timestamps', () => {
    const { lastFrame } = render(<Timeline events={sampleEvents} />);
    const frame = lastFrame()!;
    expect(frame).toContain('10:00');
    expect(frame).toContain('10:15');
    expect(frame).toContain('10:30');
    expect(frame).toContain('First deploy');
    expect(frame).toContain('Service restart');
    expect(frame).toContain('Alert fired');
  });

  it('shows type badges', () => {
    const { lastFrame } = render(<Timeline events={sampleEvents} />);
    const frame = lastFrame()!;
    expect(frame).toContain('[DEPLOY]');
    expect(frame).toContain('[RESTART]');
    expect(frame).toContain('[ALERT]');
  });

  it('shows descriptions', () => {
    const { lastFrame } = render(<Timeline events={sampleEvents} />);
    const frame = lastFrame()!;
    expect(frame).toContain('CPU usage above 90%');
  });

  it('renders connector lines', () => {
    const { lastFrame } = render(<Timeline events={sampleEvents} />);
    const frame = lastFrame()!;
    expect(frame).toContain(CHAR_DOT);
    expect(frame).toContain(CHAR_PIPE);
  });

  it('respects maxVisible and shows scroll indicators', () => {
    const { lastFrame } = render(<Timeline events={sampleEvents} maxVisible={2} />);
    const frame = lastFrame()!;
    // should show only 2 events and a "more" indicator
    expect(frame).toContain(CHAR_ARROW_DOWN);
    expect(frame).toContain('1 more');
  });

  it('renders events without type badges when type is omitted', () => {
    const events: TimelineEvent[] = [
      { time: '12:00', title: 'Plain event' },
    ];
    const { lastFrame } = render(<Timeline events={events} />);
    const frame = lastFrame()!;
    expect(frame).toContain('Plain event');
    expect(frame).not.toContain('[');
  });
});
