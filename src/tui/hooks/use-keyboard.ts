import { useInput } from 'ink';
import { useAppState, useAppDispatch, nextTopView } from '../state.js';
import type { View } from '../types.js';

export function useKeyboard(): void {
  const state = useAppState();
  const dispatch = useAppDispatch();

  useInput((input, key) => {
    // Confirm dialog takes priority
    if (state.confirmAction) {
      if (input === 'y' || input === 'Y') {
        state.confirmAction.onConfirm();
        dispatch({ type: 'CANCEL_CONFIRM' });
      } else if (input === 'n' || input === 'N' || key.escape) {
        dispatch({ type: 'CANCEL_CONFIRM' });
      }
      return;
    }

    // Redact toggle (not in text-input views)
    if (input === 'x' && state.currentView !== 'secret-edit') {
      dispatch({ type: 'TOGGLE_REDACT' });
      return;
    }

    // Quit
    if (input === 'q') {
      process.exit(0);
    }

    // Tab cycles top-level views (only from top-level views)
    if (key.tab) {
      const topViews: View[] = ['dashboard', 'health', 'secrets'];
      const base = topViews.includes(state.currentView)
        ? state.currentView
        : state.previousView ?? 'dashboard';
      dispatch({ type: 'NAVIGATE', view: nextTopView(base) });
      return;
    }

    // Escape goes back
    if (key.escape) {
      if (state.previousView) {
        dispatch({ type: 'GO_BACK' });
      }
      return;
    }
  });
}
