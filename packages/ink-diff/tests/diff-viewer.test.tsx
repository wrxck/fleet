import React from 'react';
import { render } from 'ink-testing-library';
import { describe, it, expect } from 'vitest';

import { DiffViewer } from '../src/diff-viewer.js';

describe('DiffViewer', () => {
  it('renders unified diff with colours', () => {
    const { lastFrame } = render(
      <DiffViewer oldText="hello\nworld" newText="hello\nearth" />,
    );
    const frame = lastFrame()!;
    // should contain the removed and added content
    expect(frame).toContain('world');
    expect(frame).toContain('earth');
    expect(frame).toContain('hello');
    // should contain diff markers
    expect(frame).toContain('-');
    expect(frame).toContain('+');
  });

  it('renders split mode', () => {
    const { lastFrame } = render(
      <DiffViewer
        oldText="hello\nworld"
        newText="hello\nearth"
        mode="split"
      />,
    );
    const frame = lastFrame()!;
    // split mode uses | separator
    expect(frame).toContain('|');
    // both old and new content should appear
    expect(frame).toContain('world');
    expect(frame).toContain('earth');
  });

  it('shows labels', () => {
    const { lastFrame } = render(
      <DiffViewer
        oldText="a"
        newText="b"
        oldLabel="before"
        newLabel="after"
      />,
    );
    const frame = lastFrame()!;
    expect(frame).toContain('before');
    expect(frame).toContain('after');
  });

  it('respects maxHeight', () => {
    const oldText = Array.from({ length: 20 }, (_, i) => `line ${i}`).join('\n');
    const newText = Array.from({ length: 20 }, (_, i) => `changed ${i}`).join('\n');
    const { lastFrame } = render(
      <DiffViewer oldText={oldText} newText={newText} maxHeight={5} context={0} />,
    );
    const frame = lastFrame()!;
    const outputLines = frame.split('\n').filter((l) => l.trim().length > 0);
    expect(outputLines.length).toBeLessThanOrEqual(5);
  });

  it('renders labels in split mode', () => {
    const { lastFrame } = render(
      <DiffViewer
        oldText="a"
        newText="b"
        mode="split"
        oldLabel="original"
        newLabel="modified"
      />,
    );
    const frame = lastFrame()!;
    expect(frame).toContain('original');
    expect(frame).toContain('modified');
  });

  it('renders only changed lines with context=0', () => {
    const oldText = 'a\nb\nc\nd\ne';
    const newText = 'a\nb\nX\nd\ne';
    const { lastFrame } = render(
      <DiffViewer oldText={oldText} newText={newText} context={0} />,
    );
    const frame = lastFrame()!;
    // changed lines should appear
    expect(frame).toContain('c');
    expect(frame).toContain('X');
    // unchanged surrounding lines should be hidden
    expect(frame).not.toContain('a');
    expect(frame).not.toContain('e');
  });
});
