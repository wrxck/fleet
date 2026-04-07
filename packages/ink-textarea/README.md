# @wrxck/ink-textarea

A multi-line text input component for [Ink 5](https://github.com/vadimdemedes/ink) with cursor movement and scrolling.

`ink-text-input` is single-line only -- this fills the gap.

## Install

```sh
npm install @wrxck/ink-textarea
```

## Usage

```tsx
import React, { useState } from 'react';
import { render } from 'ink';
import { TextArea } from '@wrxck/ink-textarea';

function App() {
  const [value, setValue] = useState('');

  return (
    <TextArea
      value={value}
      onChange={setValue}
      onSubmit={(text) => console.log('Submitted:', text)}
      height={10}
      placeholder="Type your message..."
    />
  );
}

render(<App />);
```

## Props

| Prop         | Type                        | Default | Description                                |
| ------------ | --------------------------- | ------- | ------------------------------------------ |
| `value`      | `string`                    |         | Current text value (controlled)            |
| `onChange`    | `(value: string) => void`   |         | Called when text changes                   |
| `onSubmit`   | `(value: string) => void`   |         | Called on Ctrl+Enter or Ctrl+S             |
| `height`     | `number`                    | `5`     | Visible rows                               |
| `placeholder`| `string`                    |         | Shown when value is empty                  |
| `focus`      | `boolean`                   | `true`  | Whether the component accepts input        |
| `showCursor` | `boolean`                   | `true`  | Show cursor position as inverted character |

## Key Bindings

- **Arrow keys** -- move cursor up/down/left/right
- **Enter** -- insert newline
- **Ctrl+Enter** or **Ctrl+S** -- trigger `onSubmit`
- **Backspace** -- delete character before cursor
- **Tab** -- insert two spaces

## License

MIT
