# ink-breadcrumb

A breadcrumb navigation trail for Ink terminal apps.

## Installation

```bash
npm install @matthesketh/ink-breadcrumb
```

Peer dependencies: `ink` (>=5.0.0), `react` (>=18.0.0).

## Usage

```tsx
import React from 'react';
import { render, Box, Text } from 'ink';
import { Breadcrumb } from '@matthesketh/ink-breadcrumb';

function App() {
  return (
    <Box flexDirection="column">
      <Breadcrumb path={['Fleet', 'Apps', 'web-api']} />
      <Text>App details view</Text>
    </Box>
  );
}

render(<App />);
```

Renders: <span style="color:gray">Fleet</span> › <span style="color:gray">Apps</span> › <span style="color:cyan; font-weight:bold">web-api</span>

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `path` | `string[]` | **required** | Ordered array of breadcrumb segments. The last segment is treated as the active item. |
| `separator` | `string` | `' › '` | String rendered between each segment. |
| `activeColor` | `string` | `'cyan'` | Ink color applied to the last (active) segment. |
| `inactiveColor` | `string` | `'gray'` | Ink color applied to all non-active segments. |

## Examples

### Custom separator and colors

```tsx
<Breadcrumb
  path={['Home', 'Settings', 'Secrets']}
  separator=" / "
  activeColor="green"
  inactiveColor="white"
/>
```

### Dynamic path from app state

```tsx
const [view, setView] = useState<string[]>(['Dashboard']);

function navigateTo(segment: string) {
  setView(prev => [...prev, segment]);
}

function navigateBack() {
  setView(prev => prev.slice(0, -1));
}

<Breadcrumb path={view} />
```

### Single segment

```tsx
<Breadcrumb path={['Dashboard']} />
```

Renders just the single segment in bold with `activeColor` -- no separator is shown.

## Notes

- Returns `null` when `path` is an empty array.
- The last segment is rendered **bold** with `activeColor`. All preceding segments use `inactiveColor`.
- Separators are rendered with `dimColor` regardless of the color props.
