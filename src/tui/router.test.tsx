import React from 'react';
import { render } from 'ink-testing-library';
import { describe, it, expect } from 'vitest';
import { InputDispatcher } from '@matthesketh/ink-input-dispatcher';

import { ViewRouter } from './router';
import { AppStateContext, AppDispatchContext, initialState } from './state';

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
