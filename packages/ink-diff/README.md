# @matthesketh/ink-diff

A diff viewer component for [Ink 5](https://github.com/vadimdemedes/ink) showing text differences with add/remove colouring. Supports unified and side-by-side (split) modes. Zero external dependencies -- implements a simple LCS-based diff algorithm inline.

## Install

```
npm install @matthesketh/ink-diff
```

Peer dependencies: `ink >= 5.0.0`, `react >= 18.0.0`

## Usage

```tsx
import React from 'react';
import { render } from 'ink';
import { DiffViewer } from '@matthesketh/ink-diff';

const oldText = `function greet() {
  return "hello";
}`;

const newText = `function greet() {
  return "hello, world";
}`;

render(
  <DiffViewer
    oldText={oldText}
    newText={newText}
    oldLabel="before"
    newLabel="after"
  />
);
```

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `oldText` | `string` | (required) | The original text |
| `newText` | `string` | (required) | The updated text |
| `mode` | `'unified' \| 'split'` | `'unified'` | Display mode |
| `context` | `number` | `3` | Lines of context around changes |
| `oldLabel` | `string` | - | Label for the old text (e.g. "before") |
| `newLabel` | `string` | - | Label for the new text (e.g. "after") |
| `maxHeight` | `number` | - | Maximum number of lines to display |

## Modes

### Unified

Shows all lines in a single column with `+` (green) for additions and `-` (red) for removals. Line numbers for both old and new files shown on the left.

### Split

Two columns side by side. Removed lines highlighted red on the left, added lines highlighted green on the right.

## Exports

- `DiffViewer` -- the React component
- `DiffViewerProps` -- TypeScript interface for props
- `diffLines(oldLines, newLines)` -- the underlying diff algorithm
- `applyContext(lines, context)` -- filter diff output to context lines
- `DiffLine` -- type for diff result entries

## License

MIT
