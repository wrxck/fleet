import React from 'react';
import { render } from 'ink-testing-library';
import { describe, it, expect } from 'vitest';

import { TestApp } from './test-app.js';

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));
const apps = ['app-alpha', 'app-bravo', 'app-charlie'];

describe('keyboard integration', () => {
  it('tab switches between top-level views', async () => {
    const { stdin, lastFrame } = render(<TestApp items={apps} />);
    await delay(100);

    expect(lastFrame()).toContain('view:dashboard');

    stdin.write('\t');
    await delay(50);
    expect(lastFrame()).toContain('view:health');

    stdin.write('\t');
    await delay(50);
    expect(lastFrame()).toContain('view:secrets');

    stdin.write('\t');
    await delay(50);
    expect(lastFrame()).toContain('view:logs-multi');

    stdin.write('\t');
    await delay(50);
    expect(lastFrame()).toContain('view:dashboard');
  });

  it('arrow down moves selection in dashboard', async () => {
    const { stdin, lastFrame } = render(<TestApp items={apps} />);
    await delay(100);

    expect(lastFrame()).toContain('> app-alpha');

    stdin.write('\x1B[B');
    await delay(50);
    expect(lastFrame()).toContain('> app-bravo');

    stdin.write('\x1B[B');
    await delay(50);
    expect(lastFrame()).toContain('> app-charlie');
  });

  it('arrow up moves selection up in dashboard', async () => {
    const { stdin, lastFrame } = render(<TestApp items={apps} />);
    await delay(100);

    stdin.write('\x1B[B');
    await delay(50);
    stdin.write('\x1B[B');
    await delay(50);
    expect(lastFrame()).toContain('> app-charlie');

    stdin.write('\x1B[A');
    await delay(50);
    expect(lastFrame()).toContain('> app-bravo');
  });

  it('j/k keys also navigate the list', async () => {
    const { stdin, lastFrame } = render(<TestApp items={apps} />);
    await delay(100);

    stdin.write('j');
    await delay(50);
    expect(lastFrame()).toContain('> app-bravo');

    stdin.write('k');
    await delay(50);
    expect(lastFrame()).toContain('> app-alpha');
  });

  it('enter selects an app and navigates to detail', async () => {
    const { stdin, lastFrame } = render(<TestApp items={apps} />);
    await delay(100);

    stdin.write('j');
    await delay(50);
    stdin.write('\r');
    await delay(50);

    expect(lastFrame()).toContain('view:app-detail');
    expect(lastFrame()).toContain('detail:app-bravo');
  });

  it('escape goes back from sub-view', async () => {
    const { stdin, lastFrame } = render(<TestApp items={apps} />);
    await delay(100);

    stdin.write('\r');
    await delay(50);
    expect(lastFrame()).toContain('view:app-detail');

    stdin.write('\x1B');
    await delay(50);
    expect(lastFrame()).toContain('view:dashboard');
  });

  it('arrow keys are clamped at list boundaries', async () => {
    const { stdin, lastFrame } = render(<TestApp items={apps} />);
    await delay(100);

    stdin.write('\x1B[A');
    await delay(50);
    expect(lastFrame()).toContain('> app-alpha');

    stdin.write('\x1B[B');
    await delay(50);
    stdin.write('\x1B[B');
    await delay(50);
    stdin.write('\x1B[B');
    await delay(50);
    expect(lastFrame()).toContain('> app-charlie');
  });

  it('? toggles help overlay and any key dismisses it', async () => {
    const { stdin, lastFrame } = render(<TestApp items={apps} />);
    await delay(100);

    stdin.write('?');
    await delay(50);
    expect(lastFrame()).toContain('help-overlay');

    stdin.write('x');
    await delay(50);
    expect(lastFrame()).not.toContain('help-overlay');
  });

  it('tab works from a sub-view, using previousView as base', async () => {
    const { stdin, lastFrame } = render(<TestApp items={apps} />);
    await delay(100);

    stdin.write('\r');
    await delay(50);
    expect(lastFrame()).toContain('view:app-detail');

    stdin.write('\t');
    await delay(50);
    expect(lastFrame()).toContain('view:health');
  });

  it('escape does nothing on top-level view with no previousView', async () => {
    const { stdin, lastFrame } = render(<TestApp items={apps} />);
    await delay(100);

    expect(lastFrame()).toContain('view:dashboard');
    stdin.write('\x1B');
    await delay(50);
    expect(lastFrame()).toContain('view:dashboard');
  });
});
