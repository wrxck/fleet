# ink-viewport

Terminal-aware viewport container that tracks terminal size and provides available height to children via React context.

## Installation

```bash
npm install @matthesketh/ink-viewport
```

## Usage

```tsx
import { Viewport, useAvailableHeight } from '@matthesketh/ink-viewport';

function App() {
  return (
    <Viewport chrome={2}>
      <StatusBar />
      <MainContent />
    </Viewport>
  );
}

function MainContent() {
  const height = useAvailableHeight();
  return <Text>Available height: {height} rows</Text>;
}
```

## Exports

### `Viewport`

A component that wraps your application, measuring the terminal size and providing available height to descendants via context.

#### Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `chrome` | `number` | `0` | Number of rows reserved for non-scrollable UI (e.g. status bars, headers). Subtracted from terminal height to compute available space. |
| `children` | `React.ReactNode` | *(required)* | Child elements rendered inside a full-height `Box`. |

### `useAvailableHeight`

```tsx
function useAvailableHeight(): number;
```

Returns the number of available rows (terminal rows minus `chrome`). Falls back to `20` if used outside a `Viewport`.

### `useTerminalSize`

```tsx
function useTerminalSize(): TerminalSize;

interface TerminalSize {
  rows: number;
  columns: number;
}
```

A hook that returns the current terminal dimensions and re-renders on resize. Falls back to `24` rows and `80` columns if `process.stdout` dimensions are unavailable.

## Examples

### Reserving space for a status bar

```tsx
import { Viewport, useAvailableHeight } from '@matthesketh/ink-viewport';
import { ScrollableList } from '@matthesketh/ink-scrollable-list';

function App() {
  return (
    <Viewport chrome={3}> {/* 1 header + 2 footer lines */}
      <Text bold>My App</Text>
      <ItemList />
      <StatusBar />
    </Viewport>
  );
}

function ItemList() {
  const maxVisible = useAvailableHeight();
  return (
    <ScrollableList
      items={items}
      selectedIndex={selected}
      maxVisible={maxVisible}
      renderItem={(item, sel) => (
        <Text color={sel ? 'cyan' : undefined}>{item.name}</Text>
      )}
    />
  );
}
```

### Using terminal size directly

```tsx
import { useTerminalSize } from '@matthesketh/ink-viewport';

function WidthAwareComponent() {
  const { columns } = useTerminalSize();
  return <Text>{'-'.repeat(columns)}</Text>;
}
```

## Notes

- The `Viewport` component renders a `Box` with `flexDirection="column"` and `height` set to the full terminal row count.
- Available height is computed as `Math.max(1, rows - chrome)`, so it always returns at least 1.
- The `useTerminalSize` hook listens to the `resize` event on `process.stdout` and updates automatically when the terminal is resized.
- The default context value for `useAvailableHeight` is `20`, used when no `Viewport` ancestor is present.
