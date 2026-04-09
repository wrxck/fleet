# @matthesketh/ink-checkbox

A standalone inline checkbox toggle component for [Ink 5](https://github.com/vadimdemedes/ink). Unlike `ink-multi-select` which is a list, this is a single inline toggle control.

## Install

```
npm install @matthesketh/ink-checkbox
```

## Usage

```tsx
import React, { useState } from 'react';
import { render } from 'ink';
import { Checkbox } from '@matthesketh/ink-checkbox';

function App() {
  const [checked, setChecked] = useState(false);

  return (
    <Checkbox
      label="Enable notifications"
      checked={checked}
      onChange={setChecked}
      color="cyan"
    />
  );
}

render(<App />);
```

## Props

| Prop       | Type                        | Default   | Description                        |
| ---------- | --------------------------- | --------- | ---------------------------------- |
| `label`    | `string`                    | ---       | Text label for the checkbox        |
| `checked`  | `boolean`                   | ---       | Whether the checkbox is checked    |
| `onChange`  | `(checked: boolean) => void`| ---       | Called when toggled                 |
| `color`    | `string`                    | `'cyan'`  | Colour of the checked indicator    |
| `disabled` | `boolean`                   | `false`   | Dim display with no interaction    |

## Behaviour

- Renders a checked or unchecked ballot box indicator with the label
- Checked indicator shown in colour, unchecked in dim
- Label is bold when checked
- Disabled state shows everything in dim
- Purely presentational --- parent controls the checked state

## License

MIT
