# ink-input-dispatcher

A two-tier input routing system for Ink apps: a global handler for app-wide shortcuts and a per-view handler that components register dynamically.

## Installation

```bash
npm install @matthesketh/ink-input-dispatcher
```

## Usage

```tsx
import { InputDispatcher, useRegisterHandler } from '@matthesketh/ink-input-dispatcher';
import type { InputHandler } from '@matthesketh/ink-input-dispatcher';

function App() {
  const globalHandler: InputHandler = (input, key) => {
    if (input === 'q') {
      process.exit(0);
      return true; // consumed
    }
  };

  return (
    <InputDispatcher globalHandler={globalHandler}>
      <ActiveView />
    </InputDispatcher>
  );
}

function ActiveView() {
  useRegisterHandler((input, key) => {
    if (key.upArrow) { /* handle up */ }
    if (key.downArrow) { /* handle down */ }
  });

  return <Text>View content</Text>;
}
```

## Exports

### `InputDispatcher`

The root component that captures all keyboard input via Ink's `useInput` and dispatches it through two layers.

#### Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `globalHandler` | `InputHandler` | `undefined` | Optional handler called first for every keypress. Return `true` to consume the input and prevent it from reaching the view handler. |
| `children` | `React.ReactNode` | *(required)* | Child elements. Descendants can register view-level handlers via `useRegisterHandler`. |

### `useRegisterHandler`

```tsx
function useRegisterHandler(handler: InputHandler): void;
```

Registers the calling component's handler as the active view-level handler. Only one view handler is active at a time -- the last component to call this hook wins. The handler is automatically cleared when the component unmounts.

### `InputHandler`

```tsx
type InputHandler = (input: string, key: Key) => boolean | void;
```

A function that receives keyboard input. The `Key` type comes from Ink. Return `true` to indicate the input was consumed and stop further processing. Return `false` or `void` to let it fall through.

## Examples

### Global shortcuts with view-specific handling

```tsx
import { InputDispatcher, useRegisterHandler } from '@matthesketh/ink-input-dispatcher';
import type { InputHandler } from '@matthesketh/ink-input-dispatcher';

function App() {
  const [view, setView] = useState<'list' | 'detail'>('list');

  const globalHandler: InputHandler = (input, key) => {
    if (key.tab) {
      setView((v) => (v === 'list' ? 'detail' : 'list'));
      return true;
    }
    if (input === 'q') {
      process.exit(0);
      return true;
    }
  };

  return (
    <InputDispatcher globalHandler={globalHandler}>
      {view === 'list' ? <ListView /> : <DetailView />}
    </InputDispatcher>
  );
}

function ListView() {
  const [selected, setSelected] = useState(0);

  useRegisterHandler((input, key) => {
    if (key.downArrow) setSelected((s) => s + 1);
    if (key.upArrow) setSelected((s) => Math.max(0, s - 1));
  });

  return <Text>List view, selected: {selected}</Text>;
}

function DetailView() {
  useRegisterHandler((input, key) => {
    // detail-specific input handling
  });

  return <Text>Detail view</Text>;
}
```

## Notes

- Input flows in two stages: global handler first, then view handler. If the global handler returns `true`, the view handler is not called.
- The view handler is stored in a ref, so swapping which component calls `useRegisterHandler` takes effect immediately without re-renders.
- Only one view handler can be active at a time. When a component unmounts, it clears the handler only if it is still the registered one (preventing accidental removal of a replacement handler).
- The `InputDispatcher` must wrap all components that use `useRegisterHandler`.
