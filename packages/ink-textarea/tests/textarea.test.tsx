import React from 'react';
import { render } from 'ink-testing-library';
import { describe, it, expect } from 'vitest';
import { TextArea } from '../src/textarea.js';

describe('TextArea', () => {
  it('renders placeholder when empty', () => {
    const { lastFrame } = render(
      <TextArea value="" onChange={() => {}} placeholder="Type here..." />,
    );
    const frame = lastFrame()!;
    expect(frame).toContain('Type here...');
  });

  it('renders text content', () => {
    const { lastFrame } = render(
      <TextArea value="Hello world" onChange={() => {}} />,
    );
    const frame = lastFrame()!;
    expect(frame).toContain('Hello');
    expect(frame).toContain('world');
  });

  it('supports multi-line display', () => {
    const { lastFrame } = render(
      <TextArea value={'Line 1\nLine 2\nLine 3'} onChange={() => {}} />,
    );
    const frame = lastFrame()!;
    expect(frame).toContain('Line 1');
    expect(frame).toContain('Line 2');
    expect(frame).toContain('Line 3');
  });
});
