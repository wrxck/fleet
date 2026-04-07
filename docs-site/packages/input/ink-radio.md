# ink-radio

A radio button group with vertical or horizontal layout for Ink terminal apps.

## Installation

```bash
npm install @matthesketh/ink-radio
```

Peer dependencies: `ink` (>=5.0.0) and `react` (>=18.0.0).

## Usage

```tsx
import React, { useState } from 'react';
import { render } from 'ink';
import { RadioGroup } from '@matthesketh/ink-radio';
import type { RadioOption } from '@matthesketh/ink-radio';

const options: RadioOption[] = [
  { label: 'Small', value: 'sm' },
  { label: 'Medium', value: 'md' },
  { label: 'Large', value: 'lg' },
  { label: 'Enterprise', value: 'xl', disabled: true },
];

function App() {
  const [size, setSize] = useState('md');

  return (
    <RadioGroup
      options={options}
      value={size}
      onChange={setSize}
    />
  );
}

render(<App />);
```

## Props

### `RadioGroupProps`

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `options` | `RadioOption[]` | **required** | Array of options to render as radio buttons. |
| `value` | `string` | `undefined` | The currently selected option value. |
| `onChange` | `(value: string) => void` | `undefined` | Callback fired when a different option should be selected. |
| `direction` | `'vertical' \| 'horizontal'` | `'vertical'` | Layout direction for the radio buttons. |
| `color` | `string` | `'cyan'` | Ink color applied to the selected option indicator and label. |

### `RadioOption`

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `label` | `string` | **required** | Displayed text for the option. |
| `value` | `string` | **required** | Unique value that identifies the option. |
| `disabled` | `boolean` | `undefined` | When `true`, renders the option with dim styling. |

## Examples

### Horizontal layout

```tsx
<RadioGroup
  options={[
    { label: 'JSON', value: 'json' },
    { label: 'YAML', value: 'yaml' },
    { label: 'TOML', value: 'toml' },
  ]}
  value="json"
  onChange={setFormat}
  direction="horizontal"
/>
```

Output: `(o) JSON ( ) YAML ( ) TOML`

### Custom color

```tsx
<RadioGroup
  options={priorities}
  value={selected}
  onChange={setSelected}
  color="yellow"
/>
```

## Visual Output

Selected and unselected options use Unicode circle indicators:

```
(o) Medium      # selected (FISHEYE U+25C9)
( ) Small       # unselected (WHITE CIRCLE U+25CB)
( ) Large       # unselected
```

## Notes

- This is a **display-only controlled component**. It does not handle keyboard input internally -- you need to wire up your own key handler (e.g. via `useInput` or `@matthesketh/ink-input-dispatcher`) to call `onChange`.
- The selected option label is rendered bold and in the specified `color`.
- Disabled options render with dim styling and are not highlighted even if their value matches.
