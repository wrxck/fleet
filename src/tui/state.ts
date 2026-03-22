import { createContext, useContext, useReducer, type Dispatch } from 'react';
import type { TuiState, Action, View } from './types.js';

const TOP_VIEWS: View[] = ['dashboard', 'health', 'secrets'];

export const initialState: TuiState = {
  currentView: 'dashboard',
  previousView: null,
  selectedApp: null,
  selectedSecret: null,
  redacted: false,
  loading: false,
  error: null,
  confirmAction: null,
};

export function reducer(state: TuiState, action: Action): TuiState {
  switch (action.type) {
    case 'NAVIGATE':
      return {
        ...state,
        previousView: state.currentView,
        currentView: action.view,
        error: null,
        confirmAction: null,
      };
    case 'GO_BACK':
      return {
        ...state,
        currentView: state.previousView ?? 'dashboard',
        previousView: null,
        selectedSecret: null,
        error: null,
        confirmAction: null,
      };
    case 'SELECT_APP':
      return { ...state, selectedApp: action.app };
    case 'SELECT_SECRET':
      return { ...state, selectedSecret: action.key };
    case 'SET_LOADING':
      return { ...state, loading: action.loading };
    case 'SET_ERROR':
      return { ...state, error: action.error };
    case 'TOGGLE_REDACT':
      return { ...state, redacted: !state.redacted };
    case 'CONFIRM':
      return { ...state, confirmAction: action.action };
    case 'CANCEL_CONFIRM':
      return { ...state, confirmAction: null };
    default:
      return state;
  }
}

export function nextTopView(current: View): View {
  const idx = TOP_VIEWS.indexOf(current);
  if (idx === -1) return 'dashboard';
  return TOP_VIEWS[(idx + 1) % TOP_VIEWS.length];
}

// Redact utility — stable mapping of real names to "app-01", "app-02", etc.
const _redactMap = new Map<string, string>();
let _redactCounter = 0;

export function redactName(name: string): string {
  let label = _redactMap.get(name);
  if (!label) {
    label = `app-${String(++_redactCounter).padStart(2, '0')}`;
    _redactMap.set(name, label);
  }
  return label;
}

export function useRedact(): (name: string) => string {
  const { redacted } = useAppState();
  if (!redacted) return (n) => n;
  return redactName;
}

export const AppStateContext = createContext<TuiState>(initialState);
export const AppDispatchContext = createContext<Dispatch<Action>>(() => {});

export function useAppState(): TuiState {
  return useContext(AppStateContext);
}

export function useAppDispatch(): Dispatch<Action> {
  return useContext(AppDispatchContext);
}

export function useTui(): [TuiState, Dispatch<Action>] {
  return [useAppState(), useAppDispatch()];
}
