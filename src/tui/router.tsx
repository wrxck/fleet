import React, { useReducer, useState, useEffect, useCallback } from 'react';
import { Box, Text } from 'ink';
import { InputDispatcher } from '@wrxck/ink-input-dispatcher';
import type { InputHandler } from '@wrxck/ink-input-dispatcher';
import { Viewport } from '@wrxck/ink-viewport';

import { reducer, initialState, AppStateContext, AppDispatchContext, nextTopView } from './state.js';
import { Header } from './components/Header.js';
import { KeyHint } from './components/KeyHint.js';
import { Confirm } from './components/Confirm.js';
import { Dashboard } from './views/Dashboard.js';
import { AppDetail } from './views/AppDetail.js';
import { SecretsView } from './views/SecretsView.js';
import { SecretEdit } from './views/SecretEdit.js';
import { HealthView } from './views/HealthView.js';
import { LogsView } from './views/LogsView.js';
import { isSealed, isInitialized } from '../core/secrets.js';
import type { View } from './types.js';

function ViewRouter(): React.JSX.Element {
  const state = React.useContext(AppStateContext);

  switch (state.currentView) {
    case 'dashboard':
      return <Dashboard />;
    case 'app-detail':
      return <AppDetail />;
    case 'health':
      return <HealthView />;
    case 'secrets':
      return <SecretsView />;
    case 'secret-edit':
      return <SecretEdit />;
    case 'logs':
      return <LogsView />;
    default:
      return <Dashboard />;
  }
}

const CHROME_ROWS = 6;

export function App(): React.JSX.Element {
  const [state, dispatch] = useReducer(reducer, initialState);
  const [vaultSealed, setVaultSealed] = useState(true);

  useEffect(() => {
    try {
      if (isInitialized()) {
        setVaultSealed(isSealed());
      }
    } catch {
      // vault may not be set up
    }

    const interval = setInterval(() => {
      try {
        if (isInitialized()) {
          const sealed = isSealed();
          setVaultSealed(prev => prev === sealed ? prev : sealed);
        }
      } catch {
        // ignore
      }
    }, 5000);

    return () => clearInterval(interval);
  }, []);

  const globalHandler: InputHandler = useCallback((input, key) => {
    if (state.confirmAction) {
      if (input === 'y' || input === 'Y') {
        state.confirmAction.onConfirm();
        dispatch({ type: 'CANCEL_CONFIRM' });
      } else if (input === 'n' || input === 'N' || key.escape) {
        dispatch({ type: 'CANCEL_CONFIRM' });
      }
      return true;
    }

    if (input === 'q' && state.currentView !== 'secret-edit') {
      process.exit(0);
      return true;
    }

    if (input === 'x' && state.currentView !== 'secret-edit') {
      dispatch({ type: 'TOGGLE_REDACT' });
      return true;
    }

    if (key.tab) {
      const topViews: View[] = ['dashboard', 'health', 'secrets'];
      const base = topViews.includes(state.currentView)
        ? state.currentView
        : state.previousView ?? 'dashboard';
      dispatch({ type: 'NAVIGATE', view: nextTopView(base) });
      return true;
    }

    if (key.escape && state.previousView) {
      dispatch({ type: 'GO_BACK' });
      return true;
    }

    return false;
  }, [state.confirmAction, state.currentView, state.previousView]);

  return (
    <AppStateContext.Provider value={state}>
      <AppDispatchContext.Provider value={dispatch}>
        <InputDispatcher globalHandler={globalHandler}>
          <Viewport chrome={CHROME_ROWS}>
            <Header vaultSealed={vaultSealed} />
            <Box flexGrow={1} flexDirection="column">
              <ViewRouter />
              <Confirm />
              {state.error && (
                <Box paddingX={1}>
                  <Box borderStyle="round" borderColor="red" paddingX={1}>
                    <Text color="red">{state.error}</Text>
                  </Box>
                </Box>
              )}
            </Box>
            <KeyHint />
          </Viewport>
        </InputDispatcher>
      </AppDispatchContext.Provider>
    </AppStateContext.Provider>
  );
}
