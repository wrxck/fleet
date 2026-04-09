# ink-tabs

A horizontal tab bar with active underline, optional badges, and customizable accent color.

## Installation

```bash
npm install @matthesketh/ink-tabs
```

Peer dependencies: `ink` (>=5.0.0), `react` (>=18.0.0).

## Usage

```tsx
import React, { useState } from 'react';
import { render, Box, Text } from 'ink';
import { Tabs } from '@matthesketh/ink-tabs';
import type { Tab } from '@matthesketh/ink-tabs';

const tabs: Tab[] = [
  { id: 'apps', label: 'Apps', badge: 12 },
  { id: 'logs', label: 'Logs' },
  { id: 'config', label: 'Config', badge: '!' },
];

function App() {
  const [activeId, setActiveId] = useState('apps');

  return (
    <Box flexDirection="column">
      <Tabs tabs={tabs} activeId={activeId} onChange={setActiveId} />
      <Text>Active tab: {activeId}</Text>
    </Box>
  );
}

render(<App />);
```

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `tabs` | `Tab[]` | **required** | Array of tab definitions. |
| `activeId` | `string` | **required** | The `id` of the currently active tab. |
| `onChange` | `(id: string) => void` | `undefined` | Callback when a tab is selected. Defined on the interface but tab switching must be handled externally (e.g., via keyboard input). |
| `accentColor` | `string` | `'cyan'` | Color used for the active tab label and its underline. |
| `separator` | `string` | `' \u2502 '` (space-pipe-space) | String rendered between tabs. |

## Types

### Tab

```ts
interface Tab {
  id: string;
  label: string;
  badge?: string | number;
}
```

## Examples

### Custom accent color and separator

```tsx
<Tabs
  tabs={tabs}
  activeId={activeId}
  accentColor="magenta"
  separator=" | "
/>
```

### Badges

Badges appear after the label in yellow. Pass a number for counts or a string for status indicators:

```tsx
const tabs: Tab[] = [
  { id: 'inbox', label: 'Inbox', badge: 3 },
  { id: 'alerts', label: 'Alerts', badge: '!' },
  { id: 'archive', label: 'Archive' },
];
```

Renders as: **Inbox (3)** | Alerts (!) | Archive

### Keyboard-driven tab switching

```tsx
import { useRegisterHandler } from '@matthesketh/ink-input-dispatcher';

const tabIds = tabs.map(t => t.id);

useRegisterHandler((input, key) => {
  if (key.tab || input === 'l') {
    setActiveId(id => {
      const idx = tabIds.indexOf(id);
      return tabIds[(idx + 1) % tabIds.length]!;
    });
    return true;
  }
  return false;
});
```

## Notes

- The active tab label is **bold** and colored with `accentColor`. A box-drawing horizontal line (U+2500, repeated) is drawn beneath it as an underline, matching the width of the label plus any badge text.
- Inactive tab labels are rendered with `dimColor`.
- The `onChange` prop is part of the interface but the component does not include built-in keyboard handling. Wire it up through your own input dispatcher.
- Tabs are separated by a box-drawing vertical bar (U+2502) by default. Pass any string to `separator` to customize.
