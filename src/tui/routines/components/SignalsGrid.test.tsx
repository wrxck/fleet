import React from 'react';

import { render } from 'ink-testing-library';
import { describe, it, expect } from 'vitest';

import type { Signal } from '../../../core/routines/schema.js';
import { SignalsGrid } from './SignalsGrid.js';

const mkSignal = (kind: Signal['kind'], state: Signal['state'], detail = ''): Signal => ({
  repo: 'demo',
  kind,
  state,
  value: state === 'ok',
  detail,
  collectedAt: new Date().toISOString(),
  ttlMs: 10_000,
});

describe('SignalsGrid', () => {
  it('renders header row with column labels', () => {
    const { lastFrame } = render(
      <SignalsGrid rows={[]} selectedIndex={0} kinds={['git-clean', 'container-up', 'ci-status']} />,
    );
    const frame = lastFrame()!;
    expect(frame).toContain('REPO');
    expect(frame).toContain('GIT');
    expect(frame).toContain('CTRS');
    expect(frame).toContain('CI');
  });

  it('renders a row with repo name when signals present', () => {
    const rows = [{ repo: 'abmanandvan', signals: [mkSignal('git-clean', 'ok')] }];
    const { lastFrame } = render(
      <SignalsGrid rows={rows} selectedIndex={0} kinds={['git-clean']} />,
    );
    expect(lastFrame()).toContain('abmanandvan');
  });

  it('shows empty-state message with no repos', () => {
    const { lastFrame } = render(
      <SignalsGrid rows={[]} selectedIndex={0} kinds={['git-clean']} />,
    );
    expect(lastFrame()).toContain('no repos registered');
  });

  it('marks the selected row with an arrow', () => {
    const rows = [
      { repo: 'first', signals: [] },
      { repo: 'second', signals: [] },
    ];
    const { lastFrame } = render(
      <SignalsGrid rows={rows} selectedIndex={1} kinds={['git-clean']} />,
    );
    const frame = lastFrame()!;
    const lines = frame.split('\n');
    const secondLine = lines.find(l => l.includes('second'));
    expect(secondLine).toContain('▶');
  });
});
