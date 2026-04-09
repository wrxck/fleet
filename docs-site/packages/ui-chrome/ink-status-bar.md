# ink-status-bar

A full-width status bar with left/center/right slots and keyboard shortcut hints for Ink terminal apps.

## Installation

```bash
npm install @matthesketh/ink-status-bar
```

Peer dependencies: `ink` (>=5.0.0) and `react` (>=18.0.0).

## Usage

```tsx
import React from 'react';
import { render, Text } from 'ink';
import { StatusBar } from '@matthesketh/ink-status-bar';
import type { KeyHint } from '@matthesketh/ink-status-bar';

const hints: KeyHint[] = [
  { key: 'q', label: 'Quit' },
  { key: 'r', label: 'Refresh' },
  { key: '?', label: 'Help' },
];

function App() {
  return (
    <StatusBar
      items={hints}
      right={<Text>v1.2.0</Text>}
    />
  );
}

render(<App />);
```

## Props

### `StatusBarProps`

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `items` | `KeyHint[]` | `undefined` | Array of keyboard shortcut hints to display. Rendered as `[key] label` pairs. |
| `left` | `React.ReactNode` | `undefined` | Content for the left slot. |
| `center` | `React.ReactNode` | `undefined` | Content for the center slot. |
| `right` | `React.ReactNode` | `undefined` | Content for the right slot. |
| `backgroundColor` | `string` | `'gray'` | Background color for all three slots. |
| `color` | `string` | `'white'` | Text color for all three slots. |

### `KeyHint`

| Property | Type | Description |
|----------|------|-------------|
| `key` | `string` | The key or shortcut to display (e.g. `'q'`, `'Ctrl+C'`). |
| `label` | `string` | Description of what the key does. |

## Slot Placement Logic

The `items` (key hints) are placed automatically based on which slots are occupied:

- If `left` is **not set**: key hints go in the **left** slot.
- If `left` is set but `center` is **not set**: key hints go in the **center** slot.
- If both `left` and `center` are set: key hints are not rendered (use explicit slot content instead).

## Examples

### Three-slot layout

```tsx
<StatusBar
  left={<Text>Dashboard</Text>}
  center={<Text bold>fleet v1.2.0</Text>}
  right={<Text>3 apps running</Text>}
  backgroundColor="blue"
/>
```

### Key hints with left content

```tsx
<StatusBar
  left={<Text>myapp</Text>}
  items={[
    { key: 'j/k', label: 'Navigate' },
    { key: 'Enter', label: 'Select' },
  ]}
  right={<Text>12:34</Text>}
/>
// "myapp" on left, key hints in center, "12:34" on right
```

### Key hints only

```tsx
<StatusBar
  items={[
    { key: 'q', label: 'Quit' },
    { key: 'Tab', label: 'Switch view' },
  ]}
/>
// Key hints on left, center and right empty
```

## Notes

- The bar stretches to the full terminal width using `process.stdout.columns` (falls back to 80 columns).
- All three slots use `flexGrow={1}` for even distribution: left is left-aligned, center is centered, right is right-aligned.
- Key hints render as `[key] label` with the key portion in bold.
