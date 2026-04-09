# @matthesketh/ink-status-bar

A fixed-position status bar component for [Ink 5](https://github.com/vadimdemedes/ink). Renders a single-row bar at the bottom of your terminal UI with key hints, mode indicators, and context info -- the kind you see in vim, htop, or nano.

## Install

```bash
npm install @matthesketh/ink-status-bar
```

## Usage

```tsx
import React from 'react';
import { render, Text } from 'ink';
import { StatusBar } from '@matthesketh/ink-status-bar';

function App() {
  return (
    <>
      {/* your app content */}
      <StatusBar
        items={[
          { key: 'q', label: 'quit' },
          { key: 'Tab', label: 'switch view' },
          { key: '?', label: 'help' },
        ]}
      />
    </>
  );
}

render(<App />);
```

### With slots

```tsx
<StatusBar
  left={<Text bold>INSERT</Text>}
  center={<Text>index.ts</Text>}
  right={<Text>3/10</Text>}
  backgroundColor="blue"
  color="white"
/>
```

### Key hints with a mode indicator

```tsx
<StatusBar
  left={<Text bold>NORMAL</Text>}
  items={[
    { key: 'i', label: 'insert' },
    { key: ':', label: 'command' },
  ]}
  right={<Text>Ln 42, Col 8</Text>}
/>
```

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `items` | `KeyHint[]` | `undefined` | Key hints displayed as `[key] label` pairs. Placed in left slot if no `left` prop, otherwise in center. |
| `left` | `React.ReactNode` | `undefined` | Content aligned to the left (e.g. mode indicator). |
| `center` | `React.ReactNode` | `undefined` | Content aligned to the center (e.g. filename). |
| `right` | `React.ReactNode` | `undefined` | Content aligned to the right (e.g. position info). |
| `backgroundColor` | `string` | `'gray'` | Background colour for the entire bar. |
| `color` | `string` | `'white'` | Default text colour. |

### KeyHint

```ts
interface KeyHint {
  key: string;    // e.g. "q", "Tab", "↑↓"
  label: string;  // e.g. "quit", "switch view"
}
```

## Requirements

- Node.js >= 18
- React >= 18.0.0
- Ink >= 5.0.0
