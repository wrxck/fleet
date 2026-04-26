import { describe, it, expect } from 'vitest';

import { reducer, initialState, nextTopView } from './state.js';
import type { TuiState, Action, View } from './types.js';

describe('nextTopView', () => {
  it('cycles dashboard → health → secrets → logs-multi → dashboard', () => {
    expect(nextTopView('dashboard')).toBe('health');
    expect(nextTopView('health')).toBe('secrets');
    expect(nextTopView('secrets')).toBe('logs-multi');
    expect(nextTopView('logs-multi')).toBe('dashboard');
  });

  it('returns dashboard for unknown views', () => {
    expect(nextTopView('app-detail' as View)).toBe('dashboard');
    expect(nextTopView('logs' as View)).toBe('dashboard');
  });
});

describe('reducer', () => {
  it('NAVIGATE sets currentView and stores previousView', () => {
    const state = reducer(initialState, { type: 'NAVIGATE', view: 'health' });
    expect(state.currentView).toBe('health');
    expect(state.previousView).toBe('dashboard');
  });

  it('NAVIGATE clears error and confirmAction', () => {
    const state: TuiState = {
      ...initialState,
      error: 'something',
      confirmAction: { label: 'x', description: 'y', onConfirm: () => {} },
    };
    const next = reducer(state, { type: 'NAVIGATE', view: 'secrets' });
    expect(next.error).toBeNull();
    expect(next.confirmAction).toBeNull();
  });

  it('GO_BACK returns to previousView', () => {
    const state: TuiState = {
      ...initialState,
      currentView: 'app-detail',
      previousView: 'dashboard',
    };
    const next = reducer(state, { type: 'GO_BACK' });
    expect(next.currentView).toBe('dashboard');
    expect(next.previousView).toBeNull();
  });

  it('GO_BACK defaults to dashboard when no previousView', () => {
    const state: TuiState = { ...initialState, currentView: 'health', previousView: null };
    const next = reducer(state, { type: 'GO_BACK' });
    expect(next.currentView).toBe('dashboard');
  });

  it('GO_BACK resets secrets subview and selected secret', () => {
    const state: TuiState = {
      ...initialState,
      currentView: 'secret-edit',
      previousView: 'secrets',
      selectedSecret: 'API_KEY',
      secretsSubView: 'secret-list',
    };
    const next = reducer(state, { type: 'GO_BACK' });
    expect(next.secretsSubView).toBe('app-list');
    expect(next.selectedSecret).toBeNull();
  });

  it('SELECT_APP stores selected app', () => {
    const state = reducer(initialState, { type: 'SELECT_APP', app: 'my-app' });
    expect(state.selectedApp).toBe('my-app');
  });

  it('SELECT_SECRET stores selected secret key', () => {
    const state = reducer(initialState, { type: 'SELECT_SECRET', key: 'DB_PASS' });
    expect(state.selectedSecret).toBe('DB_PASS');
  });

  it('SELECT_SECRET allows null for new secret', () => {
    const state = reducer(initialState, { type: 'SELECT_SECRET', key: null });
    expect(state.selectedSecret).toBeNull();
  });

  it('TOGGLE_REDACT flips redacted flag', () => {
    expect(initialState.redacted).toBeFalsy();
    const state1 = reducer(initialState, { type: 'TOGGLE_REDACT' });
    expect(state1.redacted).toBeTruthy();
    const state2 = reducer(state1, { type: 'TOGGLE_REDACT' });
    expect(state2.redacted).toBeFalsy();
  });

  it('SET_INDEX updates the correct view index', () => {
    const s1 = reducer(initialState, { type: 'SET_INDEX', view: 'dashboard', index: 5 });
    expect(s1.dashboardIndex).toBe(5);

    const s2 = reducer(initialState, { type: 'SET_INDEX', view: 'health', index: 3 });
    expect(s2.healthIndex).toBe(3);

    const s3 = reducer(initialState, { type: 'SET_INDEX', view: 'secrets', index: 2 });
    expect(s3.secretsIndex).toBe(2);

    const s4 = reducer(initialState, { type: 'SET_INDEX', view: 'appDetail', index: 4 });
    expect(s4.appDetailIndex).toBe(4);
  });

  it('SET_INDEX ignores unknown view names', () => {
    const state = reducer(initialState, { type: 'SET_INDEX', view: 'nonexistent', index: 99 });
    expect(state).toEqual(initialState);
  });

  it('SET_SECRETS_SUBVIEW changes subview and resets index', () => {
    const state: TuiState = { ...initialState, secretsIndex: 5, secretsSubView: 'app-list' };
    const next = reducer(state, { type: 'SET_SECRETS_SUBVIEW', subView: 'secret-list' });
    expect(next.secretsSubView).toBe('secret-list');
    expect(next.secretsIndex).toBe(0);
  });

  it('CONFIRM stores confirm action', () => {
    const action = { label: 'Delete?', description: 'Are you sure?', onConfirm: () => {} };
    const state = reducer(initialState, { type: 'CONFIRM', action });
    expect(state.confirmAction).toBe(action);
  });

  it('CANCEL_CONFIRM clears confirm action', () => {
    const state: TuiState = {
      ...initialState,
      confirmAction: { label: 'x', description: 'y', onConfirm: () => {} },
    };
    const next = reducer(state, { type: 'CANCEL_CONFIRM' });
    expect(next.confirmAction).toBeNull();
  });

  it('SET_ERROR stores error message', () => {
    const state = reducer(initialState, { type: 'SET_ERROR', error: 'boom' });
    expect(state.error).toBe('boom');
  });

  it('SET_LOADING updates loading flag', () => {
    const state = reducer(initialState, { type: 'SET_LOADING', loading: true });
    expect(state.loading).toBeTruthy();
  });

  // tab cycling through views (simulating what the router does)
  it('simulates tab cycling: dashboard → health → secrets → logs-multi → dashboard', () => {
    let state = initialState;
    expect(state.currentView).toBe('dashboard');

    state = reducer(state, { type: 'NAVIGATE', view: nextTopView('dashboard') });
    expect(state.currentView).toBe('health');
    expect(state.previousView).toBe('dashboard');

    state = reducer(state, { type: 'NAVIGATE', view: nextTopView('health') });
    expect(state.currentView).toBe('secrets');
    expect(state.previousView).toBe('health');

    state = reducer(state, { type: 'NAVIGATE', view: nextTopView('secrets') });
    expect(state.currentView).toBe('logs-multi');
    expect(state.previousView).toBe('secrets');

    state = reducer(state, { type: 'NAVIGATE', view: nextTopView('logs-multi') });
    expect(state.currentView).toBe('dashboard');
    expect(state.previousView).toBe('logs-multi');
  });

  // arrow key navigation simulation
  it('simulates arrow key navigation in dashboard', () => {
    let state = initialState;
    expect(state.dashboardIndex).toBe(0);

    state = reducer(state, { type: 'SET_INDEX', view: 'dashboard', index: 1 });
    expect(state.dashboardIndex).toBe(1);

    state = reducer(state, { type: 'SET_INDEX', view: 'dashboard', index: 2 });
    expect(state.dashboardIndex).toBe(2);

    state = reducer(state, { type: 'SET_INDEX', view: 'dashboard', index: 1 });
    expect(state.dashboardIndex).toBe(1);
  });
});
