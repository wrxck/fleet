import React, { useReducer, useState, useEffect, useCallback, useRef } from 'react';
import { Box, Text } from 'ink';
import { InputDispatcher } from '@matthesketh/ink-input-dispatcher';
import type { InputHandler } from '@matthesketh/ink-input-dispatcher';
import { Viewport } from '@matthesketh/ink-viewport';
import { ToastProvider } from '@matthesketh/ink-toast';
import { ToastContainer } from '@matthesketh/ink-toast';
import { checkForUpdate, applyUpdate, type UpdateInfo } from '../core/self-update.js';
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

function UpdateBanner({ info, inProgress }: { info: UpdateInfo | null; inProgress: boolean }): React.JSX.Element | null {
  if (!info?.available && !inProgress) return null;
  if (inProgress) {
    return (
      <Box paddingX={1}>
        <Box borderStyle="round" borderColor="yellow" paddingX={1}>
          <Text color="yellow">Updating fleet… (git pull + npm run build)</Text>
        </Box>
      </Box>
    );
  }
  const ahead = info!.behind;
  const subject = info!.latestSubject ? ` — ${info!.latestSubject}` : '';
  return (
    <Box paddingX={1}>
      <Box borderStyle="round" borderColor="cyan" paddingX={1}>
        <Text color="cyan">↑ Update available: {ahead} commit{ahead === 1 ? '' : 's'} ahead{subject}. Press </Text>
        <Text color="cyan" bold>U</Text>
        <Text color="cyan"> to install.</Text>
      </Box>
    </Box>
  );
}

export function App(): React.JSX.Element {
  const [state, dispatch] = useReducer(reducer, initialState);
  const [vaultSealed, setVaultSealed] = useState(true);
  const [showHelp, setShowHelp] = useState(false);
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const [updateInProgress, setUpdateInProgress] = useState(false);
  const confirmRef = useRef(state.confirmAction);
  const updateInfoRef = useRef<UpdateInfo | null>(null);
  const updateInProgressRef = useRef(false);

  useEffect(() => {
    confirmRef.current = state.confirmAction;
  }, [state.confirmAction]);
  useEffect(() => { updateInfoRef.current = updateInfo; }, [updateInfo]);
  useEffect(() => { updateInProgressRef.current = updateInProgress; }, [updateInProgress]);

  // One-shot update check on mount + a recheck every 30 minutes for long sessions.
  useEffect(() => {
    let cancelled = false;
    const run = () => {
      checkForUpdate().then(info => {
        if (!cancelled) setUpdateInfo(info);
      }).catch(() => { /* network down etc., just skip */ });
    };
    run();
    const interval = setInterval(run, 30 * 60 * 1000);
    return () => { cancelled = true; clearInterval(interval); };
  }, []);

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

    // U → apply pending update. Only fires when one is actually available.
    if ((input === 'U' || input === 'u') && state.currentView !== 'secret-edit') {
      const info = updateInfoRef.current;
      if (info?.available && !updateInProgressRef.current) {
        setUpdateInProgress(true);
        applyUpdate().then(result => {
          setUpdateInProgress(false);
          if (result.ok) {
            setUpdateInfo({ available: false, behind: 0, latestSubject: '', branch: info.branch });
          }
          // Result reported via UpdateBanner below.
          (App as any).__lastUpdateOutput = result.output;
        }).catch(err => {
          setUpdateInProgress(false);
          (App as any).__lastUpdateOutput = err instanceof Error ? err.message : String(err);
        });
        return true;
      }
    }

    if (key.tab) {
      const topViews: View[] = ['dashboard', 'health', 'secrets', 'logs-multi'];
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
              <UpdateBanner info={updateInfo} inProgress={updateInProgress} />
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
