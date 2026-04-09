# ink-file-picker

A filesystem browser for selecting files from the terminal, with directory navigation, extension filtering, and scroll support.

## Installation

```bash
npm install @matthesketh/ink-file-picker
```

Peer dependencies: `ink` (>=5.0.0), `react` (>=18.0.0).

## Usage

```tsx
import React from 'react';
import { render } from 'ink';
import { FilePicker } from '@matthesketh/ink-file-picker';

function App() {
  return (
    <FilePicker
      initialPath="/home/user/projects"
      extensions={['.ts', '.tsx']}
      onSelect={(filePath) => {
        console.log('Selected:', filePath);
        process.exit(0);
      }}
      onCancel={() => process.exit(0)}
    />
  );
}

render(<App />);
```

## Props

### `FilePickerProps`

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `initialPath` | `string` | `process.cwd()` | Starting directory. Resolved to an absolute path. |
| `extensions` | `string[]` | `undefined` | File extension filter (e.g. `['.ts', '.json']`). Directories are always shown. When not set, all files are visible. |
| `showHidden` | `boolean` | `false` | Whether to display files and directories starting with `.`. |
| `maxVisible` | `number` | `15` | Maximum number of entries visible at once before scrolling. |
| `onSelect` | `(path: string) => void` | **(required)** | Called with the full absolute path when a file is selected. |
| `onCancel` | `() => void` | `undefined` | Called when the user presses Escape. |

## Keyboard Controls

| Key | Action |
|-----|--------|
| Up Arrow / `k` | Move selection up. |
| Down Arrow / `j` | Move selection down. |
| Enter | Open the selected directory, or select the highlighted file (calls `onSelect`). |
| Backspace | Navigate to the parent directory. |
| Escape | Cancel (calls `onCancel`). |

## Examples

### Browse all files

```tsx
<FilePicker onSelect={handleSelect} />
```

Starts in the current working directory with no extension filter.

### Show hidden files with limited viewport

```tsx
<FilePicker
  showHidden
  maxVisible={8}
  onSelect={handleSelect}
/>
```

### Filter by extension

```tsx
<FilePicker
  extensions={['.md', '.txt']}
  initialPath="/home/user/docs"
  onSelect={handleSelect}
/>
```

Only `.md` and `.txt` files are shown. Directories are always visible for navigation.

## Notes

- The current directory path is displayed at the top in bold blue text.
- Directories are listed first (sorted alphabetically), then files (sorted alphabetically).
- Directories are prefixed with `> ` and files with `- `. File sizes are shown next to file names.
- File sizes are formatted as B, K, M, or G.
- The directory listing is read synchronously using `fs.readdirSync` and `fs.statSync`. Entries that cannot be stat'd are silently skipped.
- When the list exceeds `maxVisible`, scroll indicators ("more above" / "more below") are displayed.
- The extension filter includes the dot (e.g. `'.ts'` not `'ts'`).
