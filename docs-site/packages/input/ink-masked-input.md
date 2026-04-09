# ink-masked-input

A masked text input that constrains user input to a defined pattern, useful for IP addresses, dates, phone numbers, and other formatted values.

## Installation

```bash
npm install @matthesketh/ink-masked-input
```

Peer dependencies: `ink` (>=5.0.0), `react` (>=18.0.0).

## Usage

```tsx
import React, { useState } from 'react';
import { render, Box, Text } from 'ink';
import { MaskedInput, MASKS } from '@matthesketh/ink-masked-input';

function App() {
  const [ip, setIp] = useState('');

  return (
    <Box flexDirection="column">
      <Text bold>Enter IP address:</Text>
      <MaskedInput
        mask={MASKS.ip}
        value={ip}
        onChange={setIp}
        onSubmit={(value) => {
          console.log('IP:', value);
          process.exit(0);
        }}
      />
    </Box>
  );
}

render(<App />);
```

## Props

### `MaskedInputProps`

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `mask` | `string` | **(required)** | Mask pattern string. See mask characters below. |
| `value` | `string` | **(required)** | Current raw value (only editable characters, no literals). Controlled. |
| `onChange` | `(value: string) => void` | **(required)** | Called with the updated raw value whenever input changes. |
| `onSubmit` | `(value: string) => void` | `undefined` | Called when Enter is pressed and all mask slots are filled. |
| `placeholder` | `string` | `undefined` | Currently accepted but unused (reserved for future use). |
| `focus` | `boolean` | `true` | Whether the component is accepting input. |

### Mask Characters

| Character | Matches | Example |
|-----------|---------|---------|
| `9` | Any digit (0-9) | `99/99/9999` for a date |
| `a` | Any letter (a-z, A-Z) | `aaa-999` for a code |
| `*` | Any character | `**:**` for hex pairs |
| Any other | Literal (displayed as-is, skipped during input) | `/`, `-`, `:`, `(`, `)`, `+`, ` ` |

## Built-in Masks

The package exports a `MASKS` constant with common patterns:

```ts
import { MASKS } from '@matthesketh/ink-masked-input';
```

| Name | Pattern | Example Output |
|------|---------|---------------|
| `MASKS.ip` | `999.999.999.999` | `192.168.001.001` |
| `MASKS.date` | `99/99/9999` | `07/04/2026` |
| `MASKS.time` | `99:99` | `14:30` |
| `MASKS.phone` | `+99 (999) 999-9999` | `+44 (207) 946-0123` |
| `MASKS.mac` | `**:**:**:**:**:**` | `a1:b2:c3:d4:e5:f6` |

## Keyboard Controls

| Key | Action |
|-----|--------|
| Digit / letter / character | Fill the next editable slot (if it matches the slot type). |
| Backspace | Clear the previous editable slot and move cursor back. |
| Enter | Submit if all slots are filled (calls `onSubmit`). |

## Examples

### Date input

```tsx
const [date, setDate] = useState('');

<MaskedInput
  mask={MASKS.date}
  value={date}
  onChange={setDate}
  onSubmit={(val) => console.log('Date:', val)}
/>
```

### Phone number

```tsx
const [phone, setPhone] = useState('');

<MaskedInput
  mask={MASKS.phone}
  value={phone}
  onChange={setPhone}
/>
```

### Custom mask

```tsx
<MaskedInput
  mask="aaa-9999"
  value={code}
  onChange={setCode}
  onSubmit={handleSubmit}
/>
```

This accepts three letters followed by four digits, with a literal dash separator.

## Notes

- This is a controlled component. The `value` prop contains only the editable (non-literal) characters. Literal characters from the mask are not included in the value.
- The display renders unfilled slots as underscores (`_`) and literal characters in their positions.
- The cursor automatically skips over literal characters when advancing or backspacing.
- `onSubmit` only fires when every editable slot has been filled.
- Input characters that do not match the current slot type (e.g. a letter in a digit slot) are silently ignored.
