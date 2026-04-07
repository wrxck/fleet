# @wrxck/ink-keybinding-help

Auto-formatted keybinding reference overlay for Ink 5. Renders a bordered help panel from a config object, similar to pressing `?` in vim or htop.

## Install

```bash
npm install @wrxck/ink-keybinding-help
```

## Usage

```tsx
import React, { useState } from 'react';
import { render, useInput } from 'ink';
import { KeyBindingHelp } from '@wrxck/ink-keybinding-help';

function App() {
  const [showHelp, setShowHelp] = useState(false);

  useInput((input) => {
    if (input === '?') setShowHelp((v) => !v);
  });

  return (
    <KeyBindingHelp
      visible={showHelp}
      title="Keyboard Shortcuts"
      columns={2}
      groups={[
        {
          title: 'Navigation',
          bindings: [
            { key: 'j/k', description: 'navigate list' },
            { key: 'Tab', description: 'switch view' },
          ],
        },
        {
          title: 'Actions',
          bindings: [
            { key: 'Enter', description: 'confirm selection' },
            { key: 'q', description: 'quit' },
          ],
        },
      ]}
    />
  );
}

render(<App />);
```

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `groups` | `KeyBindingGroup[]` | *required* | Array of keybinding groups to display |
| `title` | `string` | `"Keyboard Shortcuts"` | Title shown at the top of the panel |
| `columns` | `number` | `2` | Number of columns to arrange groups in |
| `visible` | `boolean` | `true` | Whether the panel is rendered; set to `false` to hide |

### KeyBindingGroup

| Field | Type | Description |
|-------|------|-------------|
| `title` | `string` | Section header (e.g. "Navigation") |
| `bindings` | `KeyBinding[]` | List of key-description pairs |

### KeyBinding

| Field | Type | Description |
|-------|------|-------------|
| `key` | `string` | Key or key combination (e.g. "j/k", "Ctrl+c") |
| `description` | `string` | What the key does |

## Requirements

- Node.js >= 18
- `ink` >= 5.0.0
- `react` >= 18.0.0
