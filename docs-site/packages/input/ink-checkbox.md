# ink-checkbox

A controlled checkbox component with Unicode indicators for Ink terminal apps.

## Installation

```bash
npm install @matthesketh/ink-checkbox
```

Peer dependencies: `ink` (>=5.0.0) and `react` (>=18.0.0).

## Usage

```tsx
import React, { useState } from 'react';
import { render, Box } from 'ink';
import { Checkbox } from '@matthesketh/ink-checkbox';

function App() {
  const [notifications, setNotifications] = useState(true);
  const [darkMode, setDarkMode] = useState(false);

  return (
    <Box flexDirection="column">
      <Checkbox
        label="Enable notifications"
        checked={notifications}
        onChange={setNotifications}
      />
      <Checkbox
        label="Dark mode"
        checked={darkMode}
        onChange={setDarkMode}
        color="magenta"
      />
      <Checkbox label="Locked option" checked={true} disabled />
    </Box>
  );
}

render(<App />);
```

## Props

### `CheckboxProps`

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `label` | `string` | **required** | Text displayed next to the checkbox indicator. |
| `checked` | `boolean` | **required** | Whether the checkbox is checked. This is a controlled component. |
| `onChange` | `(checked: boolean) => void` | `undefined` | Callback fired when the checkbox value should change. |
| `color` | `string` | `'cyan'` | Ink color applied to the check indicator when checked. |
| `disabled` | `boolean` | `false` | When `true`, renders the entire checkbox with dim styling and ignores interaction. |

## Examples

### Checklist with multiple items

```tsx
const [selected, setSelected] = useState<Set<string>>(new Set());

const toggle = (id: string) => {
  setSelected((prev) => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });
};

return (
  <Box flexDirection="column">
    {['eslint', 'prettier', 'typescript'].map((tool) => (
      <Checkbox
        key={tool}
        label={tool}
        checked={selected.has(tool)}
        onChange={() => toggle(tool)}
      />
    ))}
  </Box>
);
```

### Custom color

```tsx
<Checkbox label="Urgent" checked={true} color="red" />
```

## Notes

- This is a **display-only controlled component**. It does not handle keyboard input internally -- you need to wire up your own key handler (e.g. via `useInput` or `@matthesketh/ink-input-dispatcher`) to call `onChange`.
- Uses Unicode ballot box characters: checked renders as `BALLOT BOX WITH CHECK (U+2611)`, unchecked as `BALLOT BOX (U+2610)`.
- When checked, the label is rendered bold. When disabled, the entire component uses dim styling.
