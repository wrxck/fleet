import React, { useReducer, useState, useEffect, useCallback, useRef } from 'react';
import { Box, Text } from 'ink';
import { InputDispatcher } from '@matthesketh/ink-input-dispatcher';
import type { InputHandler } from '@matthesketh/ink-input-dispatcher';
import { Viewport } from '@matthesketh/ink-viewport';
import { ToastProvider } from '@matthesketh/ink-toast';
import { ToastContainer } from '@matthesketh/ink-toast';
import { KeyBindingHelp } from '@matthesketh/ink-keybinding-help';

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

const HELP_GROUPS = [
  {
    title: 'Navigation',
    bindings: [
      { key: 'j/k', description: 'move up/down' },
      { key: 'Enter', description: 'select / confirm' },
      { key: 'Tab', description: 'switch view' },
      { key: 'Esc', description: 'go back' },
    ],
  },
  {
    title: 'Actions',
    bindings: [
      { key: 'x', description: 'toggle redaction' },
      { key: 'f', description: 'follow logs' },
      { key: 'q', description: 'quit' },
    ],
  },
  {
    title: 'Secrets',
    bindings: [
      { key: 'u', description: 'unseal vault' },
      { key: 'l', description: 'seal vault' },
      { key: 'a', description: 'add secret' },
      { key: 'd', description: 'delete secret' },
      { key: 'r', description: 'reveal / hide' },
    ],
  },
];

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
  const [showHelp, setShowHelp] = useState(false);
  const confirmRef = useRef(state.confirmAction);

  useEffect(() => {
    confirmRef.current = state.confirmAction;
  }, [state.confirmAction]);

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
    if (showHelp) {
      setShowHelp(false);
      return true;
    }

    if (confirmRef.current) {
      if (input === 'y' || input === 'Y') {
        confirmRef.current.onConfirm();
        dispatch({ type: 'CANCEL_CONFIRM' });
      } else if (input === 'n' || input === 'N' || key.escape) {
        dispatch({ type: 'CANCEL_CONFIRM' });
      }
      return true;
    }

    if (input === '?' && state.currentView !== 'secret-edit') {
      setShowHelp(true);
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
  }, [state.currentView, state.previousView, showHelp]);

  return (
    <AppStateContext.Provider value={state}>
      <AppDispatchContext.Provider value={dispatch}>
        <ToastProvider>
          <InputDispatcher globalHandler={globalHandler}>
            <Viewport chrome={CHROME_ROWS}>
              <Header vaultSealed={vaultSealed} />
              <Box flexGrow={1} flexDirection="column">
                {showHelp ? (
                  <KeyBindingHelp
                    groups={HELP_GROUPS}
                    title="Fleet TUI — Keyboard Shortcuts"
                  />
                ) : (
                  <>
                    <ViewRouter />
                    <Confirm />
                    {state.error && (
                      <Box paddingX={1}>
                        <Box borderStyle="round" borderColor="red" paddingX={1}>
                          <Text color="red">{state.error}</Text>
                        </Box>
                      </Box>
                    )}
                  </>
                )}
              </Box>
              <ToastContainer />
              <KeyHint />
            </Viewport>
          </InputDispatcher>
        </ToastProvider>
      </AppDispatchContext.Provider>
    </AppStateContext.Provider>
  );
}
