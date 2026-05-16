import React from 'react';
import { render } from 'ink-testing-library';
import { describe, it, expect, vi } from 'vitest';
import { InputDispatcher } from '@matthesketh/ink-input-dispatcher';

// stable mock fleet status. the reference must stay constant across renders:
// dashboard memoises its list items, so a changing status object would rebuild
// them anyway and mask the redaction-staleness bug this test guards.
const { MOCK_STATUS } = vi.hoisted(() => ({
  MOCK_STATUS: {
    totalApps: 3,
    healthy: 3,
    unhealthy: 0,
    apps: [
      { name: 'alpha-service', systemd: 'active', containers: '1/1', health: 'healthy' },
      { name: 'bravo-service', systemd: 'active', containers: '1/1', health: 'healthy' },
      { name: 'charlie-service', systemd: 'active', containers: '1/1', health: 'healthy' },
    ],
  },
}));

vi.mock('../hooks/use-fleet-data', () => ({
  useFleetData: () => ({ status: MOCK_STATUS, loading: false, error: null }),
}));

// fixed available height so the list renders every row under a test stdout.
vi.mock('@matthesketh/ink-viewport', () => ({
  useAvailableHeight: () => 20,
  Viewport: ({ children }: { children: React.ReactNode }) => children,
}));

import { Dashboard } from '../views/Dashboard';
import { AppStateContext, AppDispatchContext, initialState } from '../state';

const delay = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

function Harness({ redacted }: { redacted: boolean }): React.JSX.Element {
  return (
    <AppStateContext.Provider value={{ ...initialState, redacted }}>
      <AppDispatchContext.Provider value={() => {}}>
        <InputDispatcher globalHandler={() => false}>
          <Dashboard />
        </InputDispatcher>
      </AppDispatchContext.Provider>
    </AppStateContext.Provider>
  );
}

describe('redaction re-renders every visible row', () => {
  it('toggling redaction updates all app rows without scrolling', async () => {
    const { lastFrame, rerender } = render(<Harness redacted={false} />);
    await delay(50);

    const plain = lastFrame() ?? '';
    expect(plain).toContain('alpha-service');
    expect(plain).toContain('bravo-service');
    expect(plain).toContain('charlie-service');

    // flip redaction — equivalent to pressing 'x'. no j/k/arrow keys are sent,
    // so nothing scrolls; every visible row must still pick up the new label.
    rerender(<Harness redacted={true} />);
    await delay(50);

    const out = lastFrame() ?? '';
    expect(out).not.toContain('alpha-service');
    expect(out).not.toContain('bravo-service');
    expect(out).not.toContain('charlie-service');
    // redacted labels follow the app-NN pattern from redactName()
    expect(out).toMatch(/app-\d\d/);
  });
});
