import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render } from 'ink-testing-library';

import { MaskedInput } from '../src/masked-input.js';
import { MASKS } from '../src/masks.js';

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('MaskedInput', () => {
  it('renders mask placeholder with underscores', () => {
    const { lastFrame } = render(
      <MaskedInput mask="999.999.999.999" value="" onChange={() => {}} />,
    );
    expect(lastFrame()).toContain('___');
  });

  it('renders partially filled value', () => {
    const { lastFrame } = render(
      <MaskedInput mask="99/99/9999" value="12" onChange={() => {}} />,
    );
    expect(lastFrame()).toContain('12');
  });

  it('renders fully filled value', () => {
    const { lastFrame } = render(
      <MaskedInput mask="99:99" value="1234" onChange={() => {}} />,
    );
    expect(lastFrame()).toContain('12');
    expect(lastFrame()).toContain('34');
  });

  it('accepts valid digit characters', async () => {
    const onChange = vi.fn();
    const { stdin } = render(
      <MaskedInput mask="999" value="" onChange={onChange} />,
    );
    await delay(100);
    stdin.write('5');
    await delay(50);
    expect(onChange).toHaveBeenCalledWith('5');
  });

  it('skips literal positions when typing', async () => {
    const onChange = vi.fn();
    const { stdin } = render(
      <MaskedInput mask="99-99" value="12" onChange={onChange} />,
    );
    await delay(100);
    stdin.write('3');
    await delay(50);
    expect(onChange).toHaveBeenCalledWith('123');
  });

  it('rejects invalid characters for digit mask', async () => {
    const onChange = vi.fn();
    const { stdin } = render(
      <MaskedInput mask="999" value="" onChange={onChange} />,
    );
    await delay(100);
    stdin.write('a');
    await delay(50);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('accepts letters for letter mask', async () => {
    const onChange = vi.fn();
    const { stdin } = render(
      <MaskedInput mask="aaa" value="" onChange={onChange} />,
    );
    await delay(100);
    stdin.write('X');
    await delay(50);
    expect(onChange).toHaveBeenCalledWith('X');
  });

  it('rejects digits for letter mask', async () => {
    const onChange = vi.fn();
    const { stdin } = render(
      <MaskedInput mask="aaa" value="" onChange={onChange} />,
    );
    await delay(100);
    stdin.write('1');
    await delay(50);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('accepts any character for wildcard mask', async () => {
    const onChange = vi.fn();
    const { stdin } = render(
      <MaskedInput mask="***" value="" onChange={onChange} />,
    );
    await delay(100);
    stdin.write('Z');
    await delay(50);
    expect(onChange).toHaveBeenCalledWith('Z');
  });

  it('handles backspace', async () => {
    const onChange = vi.fn();
    const { stdin } = render(
      <MaskedInput mask="999" value="12" onChange={onChange} />,
    );
    await delay(100);
    stdin.write('\x7f');
    await delay(50);
    expect(onChange).toHaveBeenCalledWith('1');
  });

  it('calls onSubmit when all positions filled and Enter pressed', async () => {
    const onSubmit = vi.fn();
    const { stdin } = render(
      <MaskedInput mask="99" value="12" onChange={() => {}} onSubmit={onSubmit} />,
    );
    await delay(100);
    stdin.write('\r');
    await delay(50);
    expect(onSubmit).toHaveBeenCalledWith('12');
  });

  it('does not call onSubmit when not all positions filled', async () => {
    const onSubmit = vi.fn();
    const { stdin } = render(
      <MaskedInput mask="999" value="1" onChange={() => {}} onSubmit={onSubmit} />,
    );
    await delay(100);
    stdin.write('\r');
    await delay(50);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('exports MASKS presets', () => {
    expect(MASKS.ip).toBe('999.999.999.999');
    expect(MASKS.date).toBe('99/99/9999');
    expect(MASKS.time).toBe('99:99');
    expect(MASKS.phone).toBe('+99 (999) 999-9999');
    expect(MASKS.mac).toBe('**:**:**:**:**:**');
  });
});
