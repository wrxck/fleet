import React, { useReducer, useState, useCallback } from 'react';
import { Text, Box } from 'ink';

import { InputDispatcher, useRegisterHandler } from '@matthesketh/ink-input-dispatcher';
import type { InputHandler } from '@matthesketh/ink-input-dispatcher';

import { reducer, initialState, nextTopView } from '../state.js';
import type { View, TuiState, Action } from '../types.js';

function MockDashboard({
  state,
  dispatch,
  items,
}: {
  state: TuiState;
  dispatch: React.Dispatch<Action>;
  items: string[];
}): React.JSX.Element {
  const handler: InputHandler = (input, key) => {
    if (items.length === 0) return false;
    if (input === 'j' || key.downArrow) {
      dispatch({ type: 'SET_INDEX', view: 'dashboard', index: Math.min(state.dashboardIndex + 1, items.length - 1) });
      return true;
    }
    if (input === 'k' || key.upArrow) {
      dispatch({ type: 'SET_INDEX', view: 'dashboard', index: Math.max(state.dashboardIndex - 1, 0) });
      return true;
    }
    if (key.return) {
      dispatch({ type: 'SELECT_APP', app: items[state.dashboardIndex]! });
      dispatch({ type: 'NAVIGATE', view: 'app-detail' });
      return true;
    }
    return false;
  };

  useRegisterHandler(handler);

  return (
    <Box flexDirection="column">
      {items.map((item, i) => (
        <Text key={item}>
          {i === state.dashboardIndex ? '> ' : '  '}{item}
        </Text>
      ))}
    </Box>
  );
}

export function TestApp({ items }: { items: string[] }): React.JSX.Element {
  const [state, dispatch] = useReducer(reducer, initialState);
  const [showHelp, setShowHelp] = useState(false);

  const globalHandler: InputHandler = useCallback((input, key) => {
    if (showHelp) {
      setShowHelp(false);
      return true;
    }

    if (state.confirmAction) {
      if (input === 'y' || input === 'Y') {
        state.confirmAction.onConfirm();
        dispatch({ type: 'CANCEL_CONFIRM' });
      } else if (input === 'n' || input === 'N' || key.escape) {
        dispatch({ type: 'CANCEL_CONFIRM' });
      }
      return true;
    }

    if (input === '?') {
      setShowHelp(true);
      return true;
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
  }, [state.confirmAction, state.currentView, state.previousView, showHelp]);

  const renderView = () => {
    switch (state.currentView) {
      case 'dashboard':
        return <MockDashboard state={state} dispatch={dispatch} items={items} />;
      case 'health':
        return <Text>health-view</Text>;
      case 'secrets':
        return <Text>secrets-view</Text>;
      case 'app-detail':
        return <Text>detail:{state.selectedApp}</Text>;
      default:
        return <MockDashboard state={state} dispatch={dispatch} items={items} />;
    }
  };

  return (
    <InputDispatcher globalHandler={globalHandler}>
      <Box flexDirection="column">
        <Text>view:{state.currentView}</Text>
        {showHelp ? <Text>help-overlay</Text> : renderView()}
      </Box>
    </InputDispatcher>
  );
}
