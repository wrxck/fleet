# TUI Stability Overhaul — Design Spec

## Problem

The TUI has several bugs: flickering, needing to scroll twice, character duplication. Root causes:

1. **Multiple `useInput` handlers** — global keyboard hook + per-view + AppList all process every keypress. No propagation control in Ink.
2. **Selection state in local `useState`** — polling refreshes remount components, resetting index to 0.
3. **Polling triggers full re-renders** — vault check (5s), fleet data (10s), health (15s) all setState at root.
4. **Sync I/O in render** — `AppDetail` calls `load()`/`findApp()` on every render.
5. **Hardcoded viewport** — LogsView uses `slice(-30)` regardless of terminal size.

## Design

### 1. Single Input Dispatcher

One `useInput` in `App`. Views export plain handler functions (not hooks):

```ts
type ViewInputHandler = (
  input: string,
  key: Key,
  dispatch: Dispatch<Action>,
  state: TuiState,
) => void;
```

Root dispatcher priority:
1. Confirm dialog active → confirm handler
2. Global keys (q, tab, x, escape)
3. Active view's handler via ref

`ScrollableList` and child components never call `useInput`. They receive callbacks from parent view handlers.

### 2. Selection State in Reducer

Add to `TuiState`:

```ts
dashboardIndex: number;    // 0
healthIndex: number;       // 0
secretsIndex: number;      // 0
secretsSubView: 'app-list' | 'secret-list';
appDetailIndex: number;    // 0
```

New action: `{ type: 'SET_INDEX'; view: string; index: number }`

Index clamped to `items.length - 1` at render time, not in reducer.

### 3. ScrollableList Component

Use an existing Ink scrolling package if one fits (e.g. `ink-scroll-area`). If none fits, build a minimal windowed list:

**Props:** `items`, `selectedIndex`, `renderItem`, `maxVisible?`

**Behaviour:**
- Calculates visible rows from `process.stdout.rows` minus chrome
- Internal `scrollOffset` (display-only local state, derived from selectedIndex)
- Follow-cursor scrolling
- Scroll indicators when items above/below viewport
- No `useInput` — purely presentational

### 4. Render Optimisation

- Views that only dispatch use `useAppDispatch()`, not `useTui()`
- `useMemo` on derived arrays (dashboard items, health counts)
- `AppDetail`: move `load()`/`findApp()` to `useEffect` + state

### 5. Terminal-Aware Viewport

- LogsView: `process.stdout.rows - chrome` instead of hardcoded 30
- Listen to `process.stdout.on('resize')` for dynamic updates
- Reusable `useTerminalSize()` hook

### 6. Stale Closure Fix

`SecretsView` `useEffect` missing dependency on `secrets.refresh`. Add proper deps.

## Files Changed

- `src/tui/router.tsx` — single input dispatcher
- `src/tui/state.ts` — add per-view indices, SET_INDEX action
- `src/tui/types.ts` — update TuiState and Action types
- `src/tui/components/AppList.tsx` — replace with ScrollableList
- `src/tui/components/ScrollableList.tsx` — new (or use package)
- `src/tui/views/Dashboard.tsx` — use ScrollableList, useMemo, handler fn
- `src/tui/views/AppDetail.tsx` — handler fn, effect for registry load
- `src/tui/views/SecretsView.tsx` — handler fn, fix deps, use reducer index
- `src/tui/views/LogsView.tsx` — handler fn, terminal-aware viewport
- `src/tui/views/HealthView.tsx` — handler fn, useMemo
- `src/tui/hooks/use-keyboard.ts` — remove (absorbed into dispatcher)
- `src/tui/hooks/use-terminal-size.ts` — new hook

## Scope

Keep all existing features and keybindings. No new views. No visual redesign. Fix the bugs, make it solid.
