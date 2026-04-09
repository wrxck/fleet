# ink-keybinding-help

A multi-column keyboard shortcut help overlay for Ink apps.

## Installation

```bash
npm install @matthesketh/ink-keybinding-help
```

Peer dependencies: `ink` (>=5.0.0), `react` (>=18.0.0).

## Usage

```tsx
import React, { useState } from 'react';
import { render, Box, Text } from 'ink';
import { KeyBindingHelp } from '@matthesketh/ink-keybinding-help';
import type { KeyBindingGroup } from '@matthesketh/ink-keybinding-help';

const groups: KeyBindingGroup[] = [
  {
    title: 'Navigation',
    bindings: [
      { key: 'j/k', description: 'Move up/down' },
      { key: 'Tab', description: 'Next panel' },
      { key: 'g/G', description: 'Top/Bottom' },
    ],
  },
  {
    title: 'Actions',
    bindings: [
      { key: 'Enter', description: 'Select item' },
      { key: 'd', description: 'Delete' },
      { key: 'r', description: 'Refresh' },
    ],
  },
  {
    title: 'App',
    bindings: [
      { key: '?', description: 'Toggle help' },
      { key: 'q', description: 'Quit' },
    ],
  },
];

function App() {
  const [showHelp, setShowHelp] = useState(false);

  return (
    <Box flexDirection="column">
      <Text>Press ? for help</Text>
      <KeyBindingHelp groups={groups} visible={showHelp} columns={2} />
    </Box>
  );
}

render(<App />);
```

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `groups` | `KeyBindingGroup[]` | **required** | Array of shortcut groups to display. |
| `title` | `string` | `'Keyboard Shortcuts'` | Heading text shown at the top of the overlay. |
| `columns` | `number` | `2` | Number of columns to distribute groups across. Groups are assigned round-robin. |
| `visible` | `boolean` | `true` | When `false`, the component returns `null`. |

## Types

### KeyBindingGroup

```ts
interface KeyBindingGroup {
  title: string;
  bindings: KeyBinding[];
}
```

### KeyBinding

```ts
interface KeyBinding {
  key: string;
  description: string;
}
```

## Examples

### Single-column layout

```tsx
<KeyBindingHelp groups={groups} columns={1} />
```

### Custom title

```tsx
<KeyBindingHelp groups={groups} title="Controls" />
```

### Toggle with a keybinding

```tsx
const [visible, setVisible] = useState(false);

// In your input handler:
if (input === '?') {
  setVisible(v => !v);
  return true;
}

<KeyBindingHelp groups={groups} visible={visible} />
```

## Notes

- Keys are left-aligned and padded to the widest key across all groups for consistent alignment.
- The component renders inside a rounded border box (`borderStyle="round"`) with horizontal padding.
- Group titles are rendered bold and underlined. Key labels are dimmed; descriptions use the default color.
- Groups are distributed across columns using round-robin assignment (group 0 goes to column 0, group 1 to column 1, group 2 back to column 0, etc.).
