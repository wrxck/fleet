# ink-toast

Ephemeral toast notifications for Ink terminal apps with auto-dismiss and configurable stacking.

## Installation

```bash
npm install @matthesketh/ink-toast
```

Peer dependencies: `ink` (>=5.0.0), `react` (>=18.0.0).

## Usage

Wrap your app in `<ToastProvider>`, place `<ToastContainer />` wherever you want toasts to render, and call `useToast()` from any child component:

```tsx
import React from 'react';
import { render, Box, Text } from 'ink';
import { ToastProvider, ToastContainer, useToast } from '@matthesketh/ink-toast';

function Controls() {
  const { toast } = useToast();

  React.useEffect(() => {
    toast('App started', 'success');
    toast('Check logs for warnings', 'warning', 5000);
  }, []);

  return <Text>Press q to quit</Text>;
}

function App() {
  return (
    <ToastProvider maxToasts={5}>
      <Box flexDirection="column">
        <Controls />
        <ToastContainer />
      </Box>
    </ToastProvider>
  );
}

render(<App />);
```

## ToastProvider Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `children` | `React.ReactNode` | **required** | Child components that can access the toast context. |
| `maxToasts` | `number` | `3` | Maximum number of toasts visible at once. Oldest toasts are removed when the limit is exceeded. |

## useToast Hook

Returns an object with a single `toast` function:

```ts
const { toast } = useToast();

toast(message: string, type?: ToastType, duration?: number): void;
```

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `message` | `string` | **required** | Text to display in the toast. |
| `type` | `'success' \| 'error' \| 'info' \| 'warning'` | `'info'` | Controls the icon and color of the toast. |
| `duration` | `number` | `3000` | Auto-dismiss delay in milliseconds. |

Throws if called outside a `<ToastProvider>`.

## Toast Types

| Type | Icon | Color |
|------|------|-------|
| `success` | checkmark (U+2713) | green |
| `error` | cross (U+2717) | red |
| `info` | info symbol (U+2139) | blue |
| `warning` | warning sign (U+26A0) | yellow |

## ToastContainer

Renders the current toast stack. Takes no props -- it reads from the nearest `ToastContext`. Returns `null` when there are no active toasts.

## Examples

### Error toast with long duration

```tsx
const { toast } = useToast();
toast('Deploy failed: timeout after 30s', 'error', 10000);
```

### Limiting visible toasts

```tsx
<ToastProvider maxToasts={1}>
  {/* Only the most recent toast is shown */}
</ToastProvider>
```

## Notes

- Each toast is assigned an auto-incrementing string ID internally.
- Timers are cleaned up when toasts are dismissed early or evicted by `maxToasts`.
- The `removeToast(id)` method is available on the raw `ToastContext` if you need manual dismissal, but `useToast` exposes only `toast()` for simplicity.
- `ToastContainer` renders toasts in a vertical `<Box>` -- place it at the bottom of your layout for the most natural UX.
