# Architecture

## How the Packages Compose

The 30 packages are designed to work together through three core patterns:

### 1. Viewport Context

`ink-viewport` provides terminal dimensions to all children via React context:

```tsx
<Viewport chrome={4}>
  {/* everything inside knows the available height */}
  <MyList />
</Viewport>

function MyList() {
  const height = useAvailableHeight(); // terminal rows minus 4
  return <ScrollableList maxVisible={height} ... />;
}
```

Packages that consume viewport context: `ink-scrollable-list`, `ink-log-viewer`, `ink-pager`, `ink-split-pane`

### 2. Input Dispatcher

`ink-input-dispatcher` provides a single `useInput` at the root. Views register handlers:

```
InputDispatcher (owns useInput)
  -> globalHandler (q to quit, Tab to switch, etc.)
  -> viewHandlerRef (current view's handler)
      -> Dashboard handler (j/k to navigate, Enter to select)
      -> or HealthView handler (j/k to navigate)
      -> or SecretsView handler (j/k, u to unseal, etc.)
```

Interactive packages that use `useInput` internally: `ink-fuzzy-select`, `ink-textarea`, `ink-file-picker`, `ink-masked-input`, `ink-form`. These are focused input components — they manage their own input because they need text capture.

Presentational packages that do NOT use `useInput`: everything else. Parent views control them via props.

### 3. Controlled State

Most components are **controlled** — the parent manages state, the component renders it:

```tsx
// parent owns the state
const [selected, setSelected] = useState(0);

// component is purely presentational
<ScrollableList
  items={data}
  selectedIndex={selected}
  maxVisible={15}
  renderItem={...}
/>
```

This means:
- State survives component remounts (e.g. when data refreshes cause re-renders)
- State can live in a reducer for complex views
- Multiple components can share state without prop drilling

## Recommended App Structure

```
<AppStateContext.Provider>
  <ToastProvider>
    <InputDispatcher globalHandler={...}>
      <Viewport chrome={6}>
        <Header />          {/* ink-tabs, ink-breadcrumb */}
        <ViewRouter />      {/* switches between views */}
        <ToastContainer />  {/* ink-toast */}
        <StatusBar />       {/* ink-status-bar */}
      </Viewport>
    </InputDispatcher>
  </ToastProvider>
</AppStateContext.Provider>
```

Each view:
1. Calls `useRegisterHandler(handler)` to claim input
2. Uses `useAvailableHeight()` for viewport-aware sizing
3. Renders presentational components with controlled state
4. Uses `useToast()` to show ephemeral notifications

## Package Dependency Graph

The packages have **zero cross-dependencies**. Each package depends only on `ink` and `react` as peer dependencies. This means:

- Install only what you need
- No version conflicts between packages
- Tree-shaking works perfectly
- Each package can be used standalone

The only implicit coupling is through shared patterns (viewport context, input dispatcher) which are opt-in.
