# @wrxck/ink-toast

Timed ephemeral toast notifications for Ink 5 apps. Like toast notifications in web apps, but for the terminal.

## Install

```bash
npm install @wrxck/ink-toast
```

## Usage

```tsx
import React from 'react';
import { render, Text } from 'ink';
import { ToastProvider, ToastContainer, useToast } from '@wrxck/ink-toast';

function App() {
  const { toast } = useToast();

  React.useEffect(() => {
    toast('Deployment successful!', 'success');
    toast('Check your config', 'warning', 5000);
  }, []);

  return (
    <>
      <Text>My App</Text>
      <ToastContainer />
    </>
  );
}

render(
  <ToastProvider maxToasts={3}>
    <App />
  </ToastProvider>
);
```

## API

### `<ToastProvider>`

Wraps your app and provides toast context to all children.

| Prop       | Type     | Default | Description                        |
|------------|----------|---------|------------------------------------|
| children   | ReactNode | -      | Child components                   |
| maxToasts  | number   | 3       | Maximum visible toasts at once     |

### `useToast()`

Hook that returns a `toast()` function for creating toasts from any component inside `<ToastProvider>`.

```ts
const { toast } = useToast();
toast(message: string, type?: 'success' | 'error' | 'info' | 'warning', duration?: number): void
```

- `message` — text to display
- `type` — determines colour and icon (default: `'info'`)
- `duration` — auto-dismiss delay in ms (default: `3000`)

### `<ToastContainer />`

Renders the visible toasts. Place at the bottom of your app layout.

### Toast types

| Type    | Colour | Icon           |
|---------|--------|----------------|
| success | green  | U+2713 (check) |
| error   | red    | U+2717 (cross) |
| info    | blue   | U+2139 (info)  |
| warning | yellow | U+26A0 (warn)  |

### `Toast` interface

```ts
interface Toast {
  id: string;
  message: string;
  type: 'success' | 'error' | 'info' | 'warning';
  duration: number;
}
```

## Requirements

- Node.js >= 18
- Ink >= 5.0.0
- React >= 18.0.0

## Licence

MIT
