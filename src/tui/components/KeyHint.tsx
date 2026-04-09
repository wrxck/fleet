import React from 'react';
import { StatusBar } from '@matthesketh/ink-status-bar';
import type { KeyHint as KeyHintItem } from '@matthesketh/ink-status-bar';

import { useAppState } from '../state.js';
import type { View } from '../types.js';

const viewHints: Record<View, KeyHintItem[]> = {
  dashboard: [
    { key: 'j/k', label: 'navigate' },
    { key: 'Enter', label: 'select' },
    { key: 'Tab', label: 'switch view' },
    { key: '?', label: 'help' },
    { key: 'x', label: 'redact' },
    { key: 'q', label: 'quit' },
  ],
  'app-detail': [
    { key: 'j/k', label: 'navigate' },
    { key: 'Enter', label: 'run action' },
    { key: 'x', label: 'redact' },
    { key: 'Esc', label: 'back' },
    { key: 'q', label: 'quit' },
  ],
  health: [
    { key: 'j/k', label: 'navigate' },
    { key: 'Tab', label: 'switch view' },
    { key: 'x', label: 'redact' },
    { key: 'q', label: 'quit' },
  ],
  secrets: [
    { key: 'j/k', label: 'navigate' },
    { key: 'Enter', label: 'select' },
    { key: 'u', label: 'unseal' },
    { key: 'l', label: 'seal' },
    { key: 'a', label: 'add' },
    { key: 'd', label: 'delete' },
    { key: 'r', label: 'reveal' },
    { key: 'Esc', label: 'back' },
    { key: 'q', label: 'quit' },
  ],
  'secret-edit': [
    { key: 'Enter', label: 'save' },
    { key: 'Esc', label: 'cancel' },
  ],
  logs: [
    { key: 'f', label: 'follow' },
    { key: 'x', label: 'redact' },
    { key: 'Esc', label: 'back' },
    { key: 'q', label: 'quit' },
  ],
};

export function KeyHint(): React.JSX.Element {
  const { currentView, confirmAction } = useAppState();

  const hints = confirmAction
    ? [{ key: 'y', label: 'confirm' }, { key: 'n', label: 'cancel' }]
    : viewHints[currentView] ?? [];

  return <StatusBar items={hints} />;
}
