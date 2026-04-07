import React from 'react';
import { render } from 'ink-testing-library';
import { describe, it, expect } from 'vitest';

import { Breadcrumb } from '../src/breadcrumb.js';

describe('Breadcrumb', () => {
  it('renders path segments', () => {
    const { lastFrame } = render(
      <Breadcrumb path={['Dashboard', 'api-server', 'Logs']} />
    );
    const frame = lastFrame()!;
    expect(frame).toContain('Dashboard');
    expect(frame).toContain('api-server');
    expect(frame).toContain('Logs');
  });

  it('highlights last segment', () => {
    const { lastFrame } = render(
      <Breadcrumb path={['Dashboard', 'Logs']} />
    );
    const frame = lastFrame()!;
    // the last segment should appear in the output (bold + colour are applied via ANSI)
    expect(frame).toContain('Logs');
    expect(frame).toContain('Dashboard');
  });

  it('shows separator between segments', () => {
    const { lastFrame } = render(
      <Breadcrumb path={['A', 'B', 'C']} separator=" / " />
    );
    const frame = lastFrame()!;
    expect(frame).toContain('/');
    expect(frame).toContain('A');
    expect(frame).toContain('B');
    expect(frame).toContain('C');
  });

  it('handles single item', () => {
    const { lastFrame } = render(
      <Breadcrumb path={['Home']} />
    );
    const frame = lastFrame()!;
    expect(frame).toContain('Home');
    // no separator should appear
    expect(frame).not.toContain('\u203a');
  });

  it('renders nothing for empty path', () => {
    const { lastFrame } = render(
      <Breadcrumb path={[]} />
    );
    const frame = lastFrame()!;
    expect(frame).toBe('');
  });

  it('uses default separator', () => {
    const { lastFrame } = render(
      <Breadcrumb path={['A', 'B']} />
    );
    const frame = lastFrame()!;
    expect(frame).toContain('\u203a');
  });
});
