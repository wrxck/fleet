# ink-textarea

A multi-line text editor component with cursor navigation, scrolling, and submit support.

## Installation

```bash
npm install @matthesketh/ink-textarea
```

Peer dependencies: `ink` (>=5.0.0), `react` (>=18.0.0).

## Usage

```tsx
import React, { useState } from 'react';
import { render, Box, Text } from 'ink';
import { TextArea } from '@matthesketh/ink-textarea';

function App() {
  const [value, setValue] = useState('');

  return (
    <Box flexDirection="column">
      <Text bold>Enter your message:</Text>
      <TextArea
        value={value}
        onChange={setValue}
        onSubmit={(text) => {
          console.log('Submitted:', text);
          process.exit(0);
        }}
        height={6}
        placeholder="Start typing..."
      />
      <Text dimColor>Ctrl+Enter to submit</Text>
    </Box>
  );
}

render(<App />);
```

## Props

### `TextAreaProps`

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `value` | `string` | **(required)** | Current text content (controlled). |
| `onChange` | `(value: string) => void` | **(required)** | Called whenever the text content changes. |
| `onSubmit` | `(value: string) => void` | `undefined` | Called when the user presses Ctrl+Enter or Ctrl+S. |
| `height` | `number` | `5` | Visible height in lines. Content scrolls when it exceeds this height. |
| `placeholder` | `string` | `undefined` | Placeholder text displayed when `value` is empty. |
| `focus` | `boolean` | `true` | Whether the component is accepting input. Set to `false` to disable keyboard handling. |
| `showCursor` | `boolean` | `true` | Whether to render the cursor (shown as an inverse character). |

## Keyboard Controls

| Key | Action |
|-----|--------|
| Any character | Insert at cursor position. |
| Enter | Insert a newline. |
| Backspace | Delete the character before the cursor, or merge with the previous line. |
| Tab | Insert two spaces at cursor position. |
| Arrow keys | Move cursor (left, right, up, down). Left/right wrap across lines. |
| Ctrl+Enter | Submit (calls `onSubmit`). |
| Ctrl+S | Submit (calls `onSubmit`). |

## Examples

### Read-only display

```tsx
<TextArea
  value={logOutput}
  onChange={() => {}}
  focus={false}
  showCursor={false}
  height={10}
/>
```

### Fixed height with scrolling

```tsx
<TextArea value={value} onChange={setValue} height={3} />
```

The viewport scrolls automatically to keep the cursor visible. When the cursor moves above or below the visible area, the scroll offset adjusts.

## Notes

- This is a controlled component. You must manage `value` and pass an `onChange` handler.
- The cursor position is tracked internally as `{ line, col }` and adjusts automatically on edits.
- When `focus` is `false`, all keyboard input is ignored via Ink's `useInput` `isActive` option.
- The placeholder is only shown when `value` is an empty string.
- Tab inserts two spaces (not a tab character).
- Scrolling is line-based. The visible window is always exactly `height` lines tall (padded with empty lines if content is shorter).
