import React from 'react';
import { render } from 'ink-testing-library';
import { describe, it, expect, vi } from 'vitest';

import { TextArea } from '../src/textarea.js';

const delay = (ms: number) => new Promise(r => setTimeout(r, ms));

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

  it('typing characters calls onChange', async () => {
    const onChange = vi.fn();
    const { stdin } = render(
      <TextArea value="" onChange={onChange} />,
    );
    await delay(100);
    stdin.write('a');
    await delay(50);
    expect(onChange).toHaveBeenCalled();
    const lastCall = onChange.mock.calls[onChange.mock.calls.length - 1]![0];
    expect(lastCall).toContain('a');
  });

  it('Enter inserts newline', async () => {
    const onChange = vi.fn();
    const { stdin } = render(
      <TextArea value="" onChange={onChange} />,
    );
    await delay(100);
    stdin.write('\r');
    await delay(50);
    expect(onChange).toHaveBeenCalled();
    const lastCall = onChange.mock.calls[onChange.mock.calls.length - 1]![0];
    expect(lastCall).toContain('\n');
  });

  it('backspace removes character', async () => {
    const onChange = vi.fn();
    const { stdin } = render(
      <TextArea value="ab" onChange={onChange} />,
    );
    await delay(100);
    // move cursor to end of text
    stdin.write('\x1b[C');
    await delay(50);
    stdin.write('\x1b[C');
    await delay(50);
    onChange.mockClear();
    stdin.write('\x7f');
    await delay(50);
    expect(onChange).toHaveBeenCalled();
    const lastCall = onChange.mock.calls[onChange.mock.calls.length - 1]![0];
    expect(lastCall).toBe('a');
  });

  it('onSubmit via Ctrl+S', async () => {
    const onSubmit = vi.fn();
    const { stdin } = render(
      <TextArea value="hello" onChange={() => {}} onSubmit={onSubmit} />,
    );
    await delay(100);
    stdin.write('\x13');
    await delay(50);
    expect(onSubmit).toHaveBeenCalledWith('hello');
  });

  it('focus=false ignores input', async () => {
    const onChange = vi.fn();
    const { stdin } = render(
      <TextArea value="" onChange={onChange} focus={false} />,
    );
    await delay(100);
    stdin.write('a');
    await delay(50);
    expect(onChange).not.toHaveBeenCalled();
  });
});
