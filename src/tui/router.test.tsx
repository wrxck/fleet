import React from 'react';
import { render } from 'ink-testing-library';
import { describe, it, expect } from 'vitest';
import { InputDispatcher } from '@matthesketh/ink-input-dispatcher';

import { UpdateBanner, ViewRouter } from './router';
import { AppStateContext, AppDispatchContext, initialState } from './state';
import type { UpdateInfo } from '../core/self-update';

describe('command palette routing', () => {
  it('renders the command palette for the command-palette view', async () => {
    const { lastFrame } = render(
      <InputDispatcher globalHandler={() => false}>
        <AppStateContext.Provider value={{ ...initialState, currentView: 'command-palette' }}>
          <AppDispatchContext.Provider value={() => {}}>
            <ViewRouter />
          </AppDispatchContext.Provider>
        </AppStateContext.Provider>
      </InputDispatcher>,
    );
    await new Promise(r => setTimeout(r, 30));
    expect(lastFrame() ?? '').toContain('Command palette');
  });
});

describe('UpdateBanner', () => {
  const available: UpdateInfo = {
    available: true, behind: 5,
    latestSubject: 'Merge pull request #145 from wrxck/develop',
    branch: 'develop', remoteBranch: 'main', channel: 'stable',
  };
  const none: UpdateInfo = {
    available: false, behind: 0, latestSubject: '',
    branch: 'develop', remoteBranch: 'main', channel: 'stable',
  };

  it('renders nothing when idle with no result', () => {
    const { lastFrame } = render(<UpdateBanner info={none} inProgress={false} result={null} />);
    expect((lastFrame() ?? '').trim()).toBe('');
  });

  it('surfaces a refusal so a failed press of U is never silent', () => {
    const { lastFrame } = render(
      <UpdateBanner
        info={available}
        inProgress={false}
        result={{ ok: false, text: 'Refusing to update: working tree has uncommitted changes to tracked files.' }}
      />,
    );
    const frame = lastFrame() ?? '';
    // the failure text and the retry affordance render together.
    expect(frame).toContain('Refusing to update');
    expect(frame).toContain('Press');
  });

  it('renders the restart hint after a successful update', () => {
    const { lastFrame } = render(
      <UpdateBanner
        info={none}
        inProgress={false}
        result={{ ok: true, text: 'Updated + rebuilt. Restart the tui to run the new build.' }}
      />,
    );
    expect(lastFrame() ?? '').toContain('Restart the tui');
  });
});
