import React from 'react';

import { render } from 'ink-testing-library';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { InputDispatcher } from '@matthesketh/ink-input-dispatcher';

import { AppStateContext, AppDispatchContext, initialState } from '../state.js';
import type { TuiState, Action } from '../types.js';
import { SecretEdit } from './SecretEdit.js';

// Mock useSecrets so the component doesn't try to touch the real vault.
vi.mock('../hooks/use-secrets.js', () => ({
  useSecrets: () => ({
    initialized: true,
    sealed: false,
    apps: [],
    secrets: [],
    revealedValues: {},
    loading: false,
    error: null,
    refresh: () => {},
    loadAppSecrets: () => {},
    saveSecret: () => ({ ok: true }),
    deleteSecret: () => ({ ok: true }),
    revealSecret: () => {},
    hideSecret: () => {},
    unseal: () => ({ ok: true }),
    seal: () => ({ ok: true }),
    importEnv: () => ({ ok: true }),
  }),
}));

function renderWithState(state: TuiState) {
  const dispatch: React.Dispatch<Action> = () => {};
  return render(
    <AppStateContext.Provider value={state}>
      <AppDispatchContext.Provider value={dispatch}>
        <InputDispatcher globalHandler={() => false}>
          <SecretEdit />
        </InputDispatcher>
      </AppDispatchContext.Provider>
    </AppStateContext.Provider>,
  );
}

describe('SecretEdit (security policy: never preload secret values)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('Edit case: shows the existing key but the value field starts empty', () => {
    // Policy: editing an existing secret means re-typing the value.
    // The TUI must NOT decrypt the existing value into React state because
    // mask="*" only affects rendering, not the underlying string.
    const state: TuiState = {
      ...initialState,
      selectedApp: 'my-app',
      selectedSecret: 'API_KEY',
    };
    const { lastFrame } = renderWithState(state);
    const frame = lastFrame()!;
    expect(frame).toContain('Edit Secret');
    expect(frame).toContain('API_KEY');
    // Helper text must announce the policy.
    expect(frame).toContain('Current value not displayed');
    // Even though TextInput is rendered for the value, no plaintext or
    // mask glyphs should appear for the value (it is empty).
    // The "Value:" label is present, and any content after it on that
    // line must not contain '*' characters from a preloaded masked value.
    const valueLine = frame.split('\n').find(l => l.includes('Value:'))!;
    expect(valueLine).not.toMatch(/\*/);
  });

  it('New case: prompts for key first and shows the new-secret helper text', () => {
    const state: TuiState = {
      ...initialState,
      selectedApp: 'my-app',
      selectedSecret: null,
    };
    const { lastFrame } = renderWithState(state);
    const frame = lastFrame()!;
    expect(frame).toContain('Add Secret');
    expect(frame).toContain('Adding new secret');
    // Until the user enters a key, the value field shows the placeholder
    // and is NOT yet active.
    expect(frame).toContain('press Enter on key first');
  });

  it('does not import getSecret (no preload code path remains)', async () => {
    // Static guard: the SecretEdit module must not import getCoreSecret
    // from secrets-ops. If a future change re-introduces the preload,
    // this test fails.
    const fs = await import('node:fs');
    const url = await import('node:url');
    const source = fs.readFileSync(
      url.fileURLToPath(new URL('./SecretEdit.tsx', import.meta.url)),
      'utf8',
    );
    expect(source).not.toMatch(/getSecret as getCoreSecret/);
    expect(source).not.toMatch(/from '\.\.\/\.\.\/core\/secrets-ops/);
  });
});
