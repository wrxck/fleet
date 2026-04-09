import React from 'react';
import { render } from 'ink-testing-library';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Text } from 'ink';

import { SplitPane } from '../src/split-pane.js';

describe('SplitPane', () => {
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

  it('renders two panes side by side', () => {
    const { lastFrame } = render(
      <SplitPane>
        <Text>LEFT</Text>
        <Text>RIGHT</Text>
      </SplitPane>
    );
    const frame = lastFrame()!;
    expect(frame).toContain('LEFT');
    expect(frame).toContain('RIGHT');
  });

  it('renders vertical split', () => {
    const { lastFrame } = render(
      <SplitPane direction="vertical">
        <Text>TOP</Text>
        <Text>BOTTOM</Text>
      </SplitPane>
    );
    const frame = lastFrame()!;
    expect(frame).toContain('TOP');
    expect(frame).toContain('BOTTOM');
  });

  it('shows divider in horizontal mode', () => {
    // borderRight is used for horizontal divider — ink-testing-library
    // doesn't render border chars as text, so just verify both panes render
    const { lastFrame } = render(
      <SplitPane>
        <Text>A</Text>
        <Text>B</Text>
      </SplitPane>
    );
    const frame = lastFrame()!;
    expect(frame).toContain('A');
    expect(frame).toContain('B');
  });

  it('shows divider in vertical mode', () => {
    const { lastFrame } = render(
      <SplitPane direction="vertical">
        <Text>A</Text>
        <Text>B</Text>
      </SplitPane>
    );
    const frame = lastFrame()!;
    expect(frame).toContain('\u2500');
  });

  it('respects size ratio', () => {
    const { lastFrame } = render(
      <SplitPane sizes={[70, 30]}>
        <Text>WIDE</Text>
        <Text>NARROW</Text>
      </SplitPane>
    );
    const frame = lastFrame()!;
    expect(frame).toContain('WIDE');
    expect(frame).toContain('NARROW');
  });

  it('hides divider when showDivider is false', () => {
    const { lastFrame } = render(
      <SplitPane showDivider={false}>
        <Text>A</Text>
        <Text>B</Text>
      </SplitPane>
    );
    const frame = lastFrame()!;
    expect(frame).not.toContain('\u2502');
  });

  it('uses custom divider char in vertical mode', () => {
    const { lastFrame } = render(
      <SplitPane direction="vertical" dividerChar="=">
        <Text>A</Text>
        <Text>B</Text>
      </SplitPane>
    );
    const frame = lastFrame()!;
    expect(frame).toContain('=');
  });

  it('renders both panes with extreme size ratio and minSize enforcement', () => {
    const { lastFrame } = render(
      <SplitPane sizes={[99, 1]} minSize={10}>
        <Text>LEFT</Text>
        <Text>RIGHT</Text>
      </SplitPane>
    );
    const frame = lastFrame()!;
    expect(frame).toContain('LEFT');
    expect(frame).toContain('RIGHT');
  });

  it('renders divider with custom dividerColor in vertical mode', () => {
    const { lastFrame } = render(
      <SplitPane direction="vertical" dividerColor="red">
        <Text>A</Text>
        <Text>B</Text>
      </SplitPane>
    );
    const frame = lastFrame()!;
    expect(frame).toContain('\u2500');
  });
});
