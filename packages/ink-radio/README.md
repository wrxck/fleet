# @matthesketh/ink-radio

A radio button group for single-select in Ink 5.

## Install

```bash
npm install @matthesketh/ink-radio
```

## Usage

```tsx
import React, { useState } from 'react';
import { render } from 'ink';
import { RadioGroup } from '@matthesketh/ink-radio';

const options = [
  { label: 'Small', value: 'sm' },
  { label: 'Medium', value: 'md' },
  { label: 'Large', value: 'lg' },
];

function App() {
  const [value, setValue] = useState('md');
  return <RadioGroup options={options} value={value} onChange={setValue} />;
}

render(<App />);
```

## Props

| Prop        | Type                              | Default      | Description                    |
| ----------- | --------------------------------- | ------------ | ------------------------------ |
| `options`   | `RadioOption[]`                   | **required** | List of options to display     |
| `value`     | `string`                          | `undefined`  | Currently selected value       |
| `onChange`   | `(value: string) => void`        | `undefined`  | Called when selection changes   |
| `direction` | `'vertical' \| 'horizontal'`     | `'vertical'` | Layout direction               |
| `color`     | `string`                          | `'cyan'`     | Colour of the selected option  |

### RadioOption

```ts
interface RadioOption {
  label: string;
  value: string;
  disabled?: boolean;
}
```

## Appearance

Selected options render in bold with the configured colour. Disabled options render dim.

## License

MIT
