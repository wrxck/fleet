import React, { useReducer, useState, useEffect } from 'react';
import { Box, Text } from 'ink';
import { reducer, initialState, AppStateContext, AppDispatchContext } from './state.js';
import { useKeyboard } from './hooks/use-keyboard.js';
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

function KeyboardHandler(): null {
  useKeyboard();
  return null;
}

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

  return (
    <AppStateContext.Provider value={state}>
      <AppDispatchContext.Provider value={dispatch}>
        <KeyboardHandler />
        <Box flexDirection="column" height={process.stdout.rows || 24}>
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
        </Box>
      </AppDispatchContext.Provider>
    </AppStateContext.Provider>
  );
}
