import React from 'react';

import { render } from 'ink-testing-library';
import { describe, it, expect } from 'vitest';

import type { Signal } from '../../../core/routines/schema.js';
import { AlertsPanel } from './AlertsPanel.js';

const mk = (repo: string, kind: Signal['kind'], state: Signal['state'], detail: string): Signal => ({
  repo, kind, state, value: null, detail,
  collectedAt: new Date().toISOString(), ttlMs: 10_000,
});

describe('AlertsPanel', () => {
  it('shows "all clear" when no warn/error signals present', () => {
    const map = new Map<string, Signal[]>([
      ['a', [mk('a', 'git-clean', 'ok', '')]],
    ]);
    const { lastFrame } = render(<AlertsPanel signals={map} />);
    expect(lastFrame()).toContain('all clear');
  });

  it('lists error signals with their detail', () => {
    const map = new Map<string, Signal[]>([
      ['my-app', [mk('my-app', 'container-up', 'error', 'all containers down')]],
    ]);
    const { lastFrame } = render(<AlertsPanel signals={map} />);
    const frame = lastFrame()!;
    expect(frame).toContain('my-app');
    expect(frame).toContain('container-up');
    expect(frame).toContain('all containers down');
  });

  it('orders errors before warns', () => {
    const map = new Map<string, Signal[]>([
      ['warn-repo', [mk('warn-repo', 'git-clean', 'warn', '3 changes')]],
      ['err-repo', [mk('err-repo', 'ci-status', 'error', 'build failed')]],
    ]);
    const { lastFrame } = render(<AlertsPanel signals={map} />);
    const frame = lastFrame()!;
    const errIdx = frame.indexOf('err-repo');
    const warnIdx = frame.indexOf('warn-repo');
    expect(errIdx).toBeGreaterThan(-1);
    expect(warnIdx).toBeGreaterThan(-1);
    expect(errIdx).toBeLessThan(warnIdx);
  });

  it('truncates the alert count header', () => {
    const signals: Signal[] = [];
    for (let i = 0; i < 20; i++) signals.push(mk(`r${i}`, 'git-clean', 'error', `issue ${i}`));
    const map = new Map<string, Signal[]>();
    for (const s of signals) map.set(s.repo, [s]);
    const { lastFrame } = render(<AlertsPanel signals={map} maxRows={5} />);
    const frame = lastFrame()!;
    expect(frame).toContain('Alerts (20)');
    expect(frame).toContain('+15 more');
  });
});
