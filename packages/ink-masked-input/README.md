# @matthesketh/ink-masked-input

A template-formatted input component for Ink 5. Handles IP addresses, dates, phone numbers, and custom mask patterns.

## Install

```bash
npm install @matthesketh/ink-masked-input
```

## Usage

```tsx
import { MaskedInput, MASKS } from '@matthesketh/ink-masked-input';

function IpInput() {
  const [value, setValue] = useState('');
  return (
    <MaskedInput
      mask={MASKS.ip}
      value={value}
      onChange={setValue}
      onSubmit={(v) => console.log('IP:', v)}
    />
  );
}
```

## Mask characters

| Character | Matches         |
|-----------|-----------------|
| `9`       | Any digit (0-9) |
| `a`       | Any letter (a-z, A-Z) |
| `*`       | Any character   |
| Other     | Literal (rendered as-is, cursor skips over) |

## Presets

| Name    | Mask                    |
|---------|-------------------------|
| `ip`    | `999.999.999.999`       |
| `date`  | `99/99/9999`            |
| `time`  | `99:99`                 |
| `phone` | `+99 (999) 999-9999`   |
| `mac`   | `**:**:**:**:**:**`     |

## Props

| Prop        | Type                        | Default | Description |
|-------------|-----------------------------|---------|-------------|
| mask        | `string`                    | —       | Mask pattern |
| value       | `string`                    | —       | Current raw value (editable chars only) |
| onChange    | `(value: string) => void`   | —       | Called when value changes |
| onSubmit   | `(value: string) => void`   | —       | Called on Enter when all positions filled |
| placeholder | `string`                    | mask    | Placeholder display |
| focus       | `boolean`                   | `true`  | Whether input is active |

## License

MIT
