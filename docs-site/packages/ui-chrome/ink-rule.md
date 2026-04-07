# ink-rule

A horizontal rule (divider line) for Ink terminal apps, with optional centered title.

## Installation

```bash
npm install @matthesketh/ink-rule
```

Peer dependencies: `ink` (>=5.0.0), `react` (>=18.0.0).

## Usage

```tsx
import React from 'react';
import { render, Box, Text } from 'ink';
import { Rule } from '@matthesketh/ink-rule';

function App() {
  return (
    <Box flexDirection="column">
      <Text bold>Section One</Text>
      <Text>Some content here.</Text>
      <Rule title="Details" />
      <Text>More content below the rule.</Text>
      <Rule />
    </Box>
  );
}

render(<App />);
```

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `title` | `string` | `undefined` | Optional text centered within the rule. Rendered bold with padding on each side. |
| `char` | `string` | box-drawing horizontal (U+2500) | Character repeated to form the rule line. |
| `color` | `string` | `'grey'` | Ink color applied to the line characters. |
| `width` | `number` | `process.stdout.columns \|\| 80` | Total width of the rule in characters. Defaults to terminal width, falling back to 80. |

## Examples

### Plain divider

```tsx
<Rule />
```

Renders a full-width grey horizontal line.

### Titled divider

```tsx
<Rule title="Logs" />
```

Renders a horizontal line with " Logs " centered in bold.

The title is centered and rendered in **bold**. The remaining space is split evenly between left and right line segments.

### Custom character and color

```tsx
<Rule char="=" color="yellow" />
```

### Fixed width

```tsx
<Rule width={40} title="Status" />
```

### Double-line divider

```tsx
<Rule char="=" color="cyan" />
```

## Notes

- When a `title` is provided, it is padded with one space on each side (` Title `). The remaining width is split with `Math.ceil` for the left side and `Math.floor` for the right, so the title is slightly left-of-center on odd widths.
- If `width` is not specified, the component reads `process.stdout.columns` at render time. This means it adapts to terminal resizes automatically.
- The `char` string is repeated via `String.prototype.repeat()` -- if you pass a multi-character string, the total rendered width will exceed the `width` prop.
