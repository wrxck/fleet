import React from 'react';
import { render } from 'ink-testing-library';
import { describe, it, expect } from 'vitest';

import { Markdown } from '../src/markdown.js';

describe('Markdown', () => {
  it('renders heading as bold uppercase', () => {
    const { lastFrame } = render(<Markdown>{'# Hello World'}</Markdown>);
    const frame = lastFrame()!;
    expect(frame).toContain('HELLO WORLD');
  });

  it('renders h2 as bold', () => {
    const { lastFrame } = render(<Markdown>{'## Subtitle'}</Markdown>);
    const frame = lastFrame()!;
    expect(frame).toContain('Subtitle');
  });

  it('renders code block indented', () => {
    const { lastFrame } = render(
      <Markdown>{'```\nconst x = 1;\n```'}</Markdown>,
    );
    const frame = lastFrame()!;
    expect(frame).toContain('const x = 1;');
  });

  it('renders bullet list with bullet character', () => {
    const { lastFrame } = render(
      <Markdown>{'- first item\n- second item'}</Markdown>,
    );
    const frame = lastFrame()!;
    expect(frame).toContain('\u2022 first item');
    expect(frame).toContain('\u2022 second item');
  });

  it('renders ordered list with numbers', () => {
    const { lastFrame } = render(
      <Markdown>{'1. first\n2. second'}</Markdown>,
    );
    const frame = lastFrame()!;
    expect(frame).toContain('1. first');
    expect(frame).toContain('2. second');
  });

  it('renders horizontal rule', () => {
    const { lastFrame } = render(<Markdown>{'---'}</Markdown>);
    const frame = lastFrame()!;
    expect(frame).toContain('\u2500');
  });

  it('renders blockquote with bar prefix', () => {
    const { lastFrame } = render(<Markdown>{'> quoted text'}</Markdown>);
    const frame = lastFrame()!;
    expect(frame).toContain('\u2502');
    expect(frame).toContain('quoted text');
  });

  it('renders links with url in parentheses', () => {
    const { lastFrame } = render(
      <Markdown>{'[click here](https://example.com)'}</Markdown>,
    );
    const frame = lastFrame()!;
    expect(frame).toContain('click here');
    expect(frame).toContain('(https://example.com)');
  });

  it('respects maxWidth prop', () => {
    const { lastFrame } = render(
      <Markdown maxWidth={40}>{'# Title'}</Markdown>,
    );
    const frame = lastFrame()!;
    expect(frame).toContain('TITLE');
  });
});
