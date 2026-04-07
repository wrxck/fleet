import React from 'react';
import { render } from 'ink-testing-library';
import { describe, it, expect } from 'vitest';

import { Pager } from '../src/pager.js';

describe('Pager', () => {
  it('renders a content window', () => {
    const content = 'line1\nline2\nline3\nline4\nline5';
    const { lastFrame } = render(
      <Pager content={content} height={4} wrap={false} />
    );
    const frame = lastFrame()!;
    expect(frame).toContain('line1');
    expect(frame).toContain('line2');
    expect(frame).toContain('line3');
    expect(frame).not.toContain('line4');
    expect(frame).toContain('Line 1-3 of 5');
  });

  it('shows line numbers when enabled', () => {
    const content = 'alpha\nbeta\ngamma';
    const { lastFrame } = render(
      <Pager content={content} height={4} showLineNumbers wrap={false} />
    );
    const frame = lastFrame()!;
    expect(frame).toContain('1 ');
    expect(frame).toContain('2 ');
    expect(frame).toContain('3 ');
    expect(frame).toContain('alpha');
  });

  it('highlights search matches', () => {
    const content = 'hello world\nfoo bar\nhello again';
    const { lastFrame } = render(
      <Pager content={content} height={4} searchQuery="hello" wrap={false} />
    );
    const frame = lastFrame()!;
    expect(frame).toContain('hello');
    expect(frame).toContain('world');
    expect(frame).toContain('again');
  });

  it('shows scroll position indicator', () => {
    const content = Array.from({ length: 20 }, (_, i) => `line${i + 1}`).join('\n');
    const { lastFrame } = render(
      <Pager content={content} height={6} scrollOffset={5} wrap={false} />
    );
    const frame = lastFrame()!;
    expect(frame).toContain('Line 6-10 of 20');
    expect(frame).toContain('line6');
    expect(frame).not.toContain('line1\n');
  });

  it('respects scrollOffset', () => {
    const content = 'a\nb\nc\nd\ne\nf';
    const { lastFrame } = render(
      <Pager content={content} height={3} scrollOffset={3} wrap={false} />
    );
    const frame = lastFrame()!;
    expect(frame).toContain('d');
    expect(frame).toContain('e');
    expect(frame).not.toContain('a');
  });

  it('renders empty content', () => {
    const { lastFrame } = render(
      <Pager content="" height={4} wrap={false} />
    );
    const frame = lastFrame()!;
    // indicator should show line info
    expect(frame).toMatch(/Line \d/);
  });

  it('renders with a very long line', () => {
    const longLine = 'x'.repeat(200);
    const { lastFrame } = render(
      <Pager content={longLine} height={4} wrap={false} />
    );
    const frame = lastFrame()!;
    expect(frame).toBeTruthy();
    expect(frame).toContain('Line 1');
  });
});
