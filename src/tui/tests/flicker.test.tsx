import React from 'react';
import { render } from 'ink-testing-library';
import { describe, it, expect } from 'vitest';

import { TestApp } from './test-app.js';

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));
const apps = ['app-alpha', 'app-bravo', 'app-charlie'];

describe('no-flicker guarantees', () => {
  it('tab switch produces no intermediate frames', async () => {
    const { stdin, frames } = render(<TestApp items={apps} />);
    await delay(100);

    const beforeCount = frames.length;
    stdin.write('\t');
    await delay(50);

    // grab only the frames produced by this action
    const newFrames = frames.slice(beforeCount);
    // every new frame must show the destination view, never a blank or half-state
    for (const frame of newFrames) {
      expect(frame).toContain('view:');
      // should not show a frame with view:dashboard after we switched to health
      expect(frame).toContain('view:health');
    }
  });

  it('enter on dashboard does not flash dashboard before showing detail', async () => {
    const { stdin, frames } = render(<TestApp items={apps} />);
    await delay(100);

    stdin.write('j');
    await delay(50);

    const beforeCount = frames.length;
    stdin.write('\r');
    await delay(50);

    const newFrames = frames.slice(beforeCount);
    // should have at least one frame with the detail view
    const detailFrames = newFrames.filter(f => f.includes('view:app-detail'));
    expect(detailFrames.length).toBeGreaterThan(0);

    // no frame should show view:dashboard after the enter press
    // (which would indicate SELECT_APP rendered before NAVIGATE)
    for (const frame of newFrames) {
      if (frame.includes('view:')) {
        expect(frame).toContain('view:app-detail');
      }
    }
  });

  it('arrow key navigation produces exactly one visual change', async () => {
    const { stdin, frames } = render(<TestApp items={apps} />);
    await delay(100);

    const beforeCount = frames.length;
    stdin.write('\x1B[B'); // down arrow
    await delay(50);

    const newFrames = frames.slice(beforeCount);
    // all new frames should show the cursor on app-bravo
    for (const frame of newFrames) {
      expect(frame).toContain('> app-bravo');
    }
  });

  it('escape from sub-view does not flash intermediate state', async () => {
    const { stdin, frames } = render(<TestApp items={apps} />);
    await delay(100);

    // go to detail
    stdin.write('\r');
    await delay(50);
    expect(frames[frames.length - 1]).toContain('view:app-detail');

    const beforeCount = frames.length;
    stdin.write('\x1B');
    await delay(50);

    const newFrames = frames.slice(beforeCount);
    for (const frame of newFrames) {
      expect(frame).toContain('view:dashboard');
    }
  });

  it('rapid key presses do not produce garbled frames', async () => {
    const { stdin, frames } = render(<TestApp items={apps} />);
    await delay(100);

    // rapid j-j-j
    stdin.write('j');
    stdin.write('j');
    stdin.write('j');
    await delay(100);

    const lastFrame = frames[frames.length - 1]!;
    // should be clamped at the last item
    expect(lastFrame).toContain('> app-charlie');
    // should still show the view label
    expect(lastFrame).toContain('view:dashboard');
  });

  it('help overlay toggle produces no blank frames', async () => {
    const { stdin, frames } = render(<TestApp items={apps} />);
    await delay(100);

    const beforeCount = frames.length;
    stdin.write('?');
    await delay(50);

    const helpFrames = frames.slice(beforeCount);
    for (const frame of helpFrames) {
      expect(frame).toContain('view:dashboard');
      expect(frame).toContain('help-overlay');
    }

    const beforeDismiss = frames.length;
    stdin.write('x');
    await delay(50);

    const dismissFrames = frames.slice(beforeDismiss);
    for (const frame of dismissFrames) {
      expect(frame).toContain('view:dashboard');
      // help should be gone
      expect(frame).not.toContain('help-overlay');
    }
  });
});
