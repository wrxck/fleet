# ink-diff

A diff viewer component for Ink 5 showing text differences with add/remove colouring.

## Installation

```bash
npm install @matthesketh/ink-diff
```

Peer dependencies: `ink` (>=5.0.0), `react` (>=18.0.0).

## Usage

```tsx
import React from 'react';
import { render } from 'ink';
import { DiffViewer } from '@matthesketh/ink-diff';

const oldText = `function greet(name) {
  console.log("Hello, " + name);
  return true;
}`;

const newText = `function greet(name: string) {
  console.log(\`Hello, \${name}\`);
  return true;
}`;

function App() {
  return (
    <DiffViewer
      oldText={oldText}
      newText={newText}
      oldLabel="greet.js"
      newLabel="greet.ts"
    />
  );
}

render(<App />);
```

## DiffViewer Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `oldText` | `string` | **(required)** | The original text (split on `\n`). |
| `newText` | `string` | **(required)** | The new text (split on `\n`). |
| `mode` | `"unified" \| "split"` | `"unified"` | Display mode. Unified shows a single column with `+`/`-` prefixes. Split shows old and new side by side. |
| `context` | `number` | `3` | Number of unchanged context lines to show around each change. |
| `oldLabel` | `string` | `undefined` | Label for the old file (shown as `--- label` in unified, plain text in split). |
| `newLabel` | `string` | `undefined` | Label for the new file (shown as `+++ label` in unified, plain text in split). |
| `maxHeight` | `number` | `undefined` | Truncate the diff output to this many lines. |

## Examples

### Split mode

```tsx
<DiffViewer
  oldText={before}
  newText={after}
  mode="split"
  oldLabel="v1.0"
  newLabel="v1.1"
/>
```

Side-by-side display with a `|` separator. Removed lines pair with added lines when adjacent; otherwise they appear on their respective side with an empty opposite column.

### Adjusting context

```tsx
<DiffViewer
  oldText={before}
  newText={after}
  context={0}
/>
```

Setting `context` to `0` shows only changed lines with no surrounding context.

### Using the diff utilities directly

The underlying `diffLines` and `applyContext` functions are exported:

```ts
import { diffLines, applyContext } from '@matthesketh/ink-diff';
import type { DiffLine } from '@matthesketh/ink-diff';

const oldLines = oldText.split('\n');
const newLines = newText.split('\n');

const diff: DiffLine[] = diffLines(oldLines, newLines);
const filtered: DiffLine[] = applyContext(diff, 3);
```

#### DiffLine type

```ts
type DiffLine = {
  type: 'add' | 'remove' | 'unchanged';
  content: string;
  oldLineNo?: number;
  newLineNo?: number;
};
```

- `add` lines have `newLineNo` set.
- `remove` lines have `oldLineNo` set.
- `unchanged` lines have both `oldLineNo` and `newLineNo` set.

## Notes

- The diff algorithm uses an O(n*m) Longest Common Subsequence (LCS) approach. It works well for reasonably sized inputs but is not optimised for very large files.
- Added lines are coloured green with a `+` prefix. Removed lines are coloured red with a `-` prefix.
- In split mode, adjacent remove+add pairs are displayed on the same row. Non-paired changes leave the opposite column empty.
- Line numbers are shown in a dimmed gutter. The gutter width adjusts automatically to the maximum line number.
- The `context` filter runs after the diff is computed. Setting `context` to a negative number disables filtering and shows all lines.
