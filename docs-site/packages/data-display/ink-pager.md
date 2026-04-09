# ink-pager

A less-like scrollable content viewer for Ink 5.

## Installation

```bash
npm install @matthesketh/ink-pager
```

Peer dependencies: `ink` (>=5.0.0), `react` (>=18.0.0).

## Usage

```tsx
import React, { useState, useCallback } from 'react';
import { render } from 'ink';
import { Pager } from '@matthesketh/ink-pager';

const longText = Array.from({ length: 100 }, (_, i) => `Line ${i + 1}: Lorem ipsum dolor sit amet`).join('\n');

function App() {
  const [offset, setOffset] = useState(0);

  // Wire up your own input handler for scrolling
  // e.g. j/k or arrow keys to adjust offset

  return (
    <Pager
      content={longText}
      height={20}
      scrollOffset={offset}
      showLineNumbers
      searchQuery="ipsum"
    />
  );
}

render(<App />);
```

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `content` | `string` | **(required)** | The text content to display. Lines are split on `\n`. |
| `height` | `number` | **(required)** | Total height in rows (including the status line at the bottom). |
| `showLineNumbers` | `boolean` | `false` | Show line numbers in the left gutter. |
| `wrap` | `boolean` | `true` | Wrap long lines to fit the terminal width. When `false`, lines extend beyond the viewport. |
| `searchQuery` | `string` | `undefined` | Highlight all case-insensitive occurrences of this string in yellow bold. |
| `scrollOffset` | `number` | `0` | Zero-based line offset for scrolling. Clamped to valid range internally. |
| `onScroll` | `(offset: number) => void` | `undefined` | Callback when scroll position changes (available for external wiring). |

## Examples

### Basic file viewer

```tsx
import fs from 'fs';

const fileContent = fs.readFileSync('./src/index.ts', 'utf-8');

<Pager content={fileContent} height={25} showLineNumbers />
```

### Search highlighting

```tsx
<Pager
  content={logOutput}
  height={15}
  searchQuery="ERROR"
/>
```

All occurrences of "ERROR" (case-insensitive) are rendered in bold yellow.

### Without line wrapping

```tsx
<Pager content={wideContent} height={20} wrap={false} />
```

## Notes

- The bottom row is always reserved for a status indicator showing `Line X-Y of Z`.
- Line wrapping uses word-break logic: it tries to break at the last space within the terminal width, falling back to a hard break if no space is found.
- The `scrollOffset` is clamped so you cannot scroll past the end of the content.
- The terminal width is read from `process.stdout.columns` (defaulting to 80). Line number gutter width is subtracted from the available content width when wrapping.
- The component does not handle keyboard input itself. Manage `scrollOffset` externally (e.g. via `@matthesketh/ink-input-dispatcher`).
