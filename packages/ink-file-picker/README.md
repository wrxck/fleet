# @wrxck/ink-file-picker

A filesystem navigator and file picker for [Ink 5](https://github.com/vadimdemedes/ink). Navigate directories, select files, and filter by extension.

## Install

```bash
npm install @wrxck/ink-file-picker
```

## Usage

```tsx
import React from 'react';
import { render } from 'ink';
import { FilePicker } from '@wrxck/ink-file-picker';

function App() {
  return (
    <FilePicker
      extensions={['.ts', '.tsx']}
      onSelect={(filePath) => {
        console.log('Selected:', filePath);
      }}
      onCancel={() => {
        console.log('Cancelled');
      }}
    />
  );
}

render(<App />);
```

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `initialPath` | `string` | `process.cwd()` | Starting directory |
| `extensions` | `string[]` | `undefined` | Filter files by extension (e.g. `['.ts', '.tsx']`) |
| `showHidden` | `boolean` | `false` | Show hidden files (starting with `.`) |
| `maxVisible` | `number` | `15` | Maximum visible items in the windowed list |
| `onSelect` | `(path: string) => void` | required | Called when a file is selected |
| `onCancel` | `() => void` | `undefined` | Called when Escape is pressed |

## Keybindings

| Key | Action |
|-----|--------|
| `j` / `Down` | Move selection down |
| `k` / `Up` | Move selection up |
| `Enter` | Open directory or select file |
| `Backspace` | Go up one directory |
| `Escape` | Cancel |

## Features

- Folders listed first with `▸` prefix, files with `·` prefix
- File sizes shown in dim text
- Windowed scrolling with `maxVisible` limit and scroll indicators
- Extension filtering (directories always shown)
- Hidden file toggle

## License

MIT
