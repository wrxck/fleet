# ink-switch

A toggle switch component with configurable labels and colors for Ink terminal apps.

## Installation

```bash
npm install @matthesketh/ink-switch
```

Peer dependencies: `ink` (>=5.0.0) and `react` (>=18.0.0).

## Usage

```tsx
import React, { useState } from 'react';
import { render, Box } from 'ink';
import { Switch } from '@matthesketh/ink-switch';

function App() {
  const [enabled, setEnabled] = useState(false);

  return (
    <Box flexDirection="column" gap={1}>
      <Switch value={enabled} onChange={setEnabled} label="Auto-deploy" />
      <Switch value={true} onLabel="Yes" offLabel="No" onColor="blue" label="Verbose logging" />
      <Switch value={false} label="Maintenance mode" disabled />
    </Box>
  );
}

render(<App />);
```

## Props

### `SwitchProps`

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `value` | `boolean` | **required** | Current state of the switch. This is a controlled component. |
| `onChange` | `(value: boolean) => void` | `undefined` | Callback fired when the switch value should change. |
| `label` | `string` | `undefined` | Optional label displayed after the state label. |
| `onLabel` | `string` | `'ON'` | Text shown when the switch is on. |
| `offLabel` | `string` | `'OFF'` | Text shown when the switch is off. |
| `onColor` | `string` | `'green'` | Ink color for the track when the switch is on. |
| `offColor` | `string` | `'red'` | Ink color for the track when the switch is off. |
| `disabled` | `boolean` | `false` | When `true`, renders with dim styling. |

## Examples

### Custom labels and colors

```tsx
<Switch
  value={isProduction}
  onChange={setIsProduction}
  onLabel="PROD"
  offLabel="DEV"
  onColor="red"
  offColor="green"
  label="Environment"
/>
```

### Status indicator (read-only)

```tsx
<Switch value={isConnected} onLabel="Connected" offLabel="Disconnected" />
```

## Visual Output

The switch renders an ASCII track that changes position based on state:

```
(*)-- ON Auto-deploy     # value = true
--(*) OFF Auto-deploy    # value = false
```

## Notes

- This is a **display-only controlled component**. It does not handle keyboard input internally -- you need to wire up your own key handler (e.g. via `useInput` or `@matthesketh/ink-input-dispatcher`) to call `onChange`.
- The track and state label color change based on `onColor`/`offColor`.
- When `disabled` is `true`, all text renders with dim styling and the color is removed.
