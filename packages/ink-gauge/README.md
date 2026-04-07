# @matthesketh/ink-gauge

A progress gauge and donut visualisation component for Ink 5 terminal dashboards.

## Install

```sh
npm install @matthesketh/ink-gauge
```

## Usage

### Gauge (horizontal bar)

```tsx
import { Gauge } from '@matthesketh/ink-gauge';

<Gauge value={75} />

<Gauge value={45} label="CPU" width={10} />

<Gauge
  value={90}
  thresholds={[
    { value: 80, color: 'yellow' },
    { value: 95, color: 'red' },
  ]}
/>
```

### Donut

```tsx
import { Donut } from '@matthesketh/ink-gauge';

<Donut value={40} />

<Donut value={75} size="large" />
```

## API

### `<Gauge />`

| Prop             | Type                                  | Default   | Description                          |
| ---------------- | ------------------------------------- | --------- | ------------------------------------ |
| `value`          | `number`                              | required  | 0-100 percentage                     |
| `width`          | `number`                              | `20`      | Bar character count                  |
| `filledChar`     | `string`                              | -         | Character for filled portion         |
| `emptyChar`      | `string`                              | -         | Character for empty portion          |
| `color`          | `string`                              | `'green'` | Colour of filled portion             |
| `showPercentage` | `boolean`                             | `true`    | Show percentage after bar            |
| `label`          | `string`                              | -         | Label before bar                     |
| `thresholds`     | `{ value: number; color: string }[]`  | -         | Auto-select colour based on value    |

### `<Donut />`

| Prop    | Type                   | Default   | Description                    |
| ------- | ---------------------- | --------- | ------------------------------ |
| `value` | `number`               | required  | 0-100 percentage               |
| `label` | `string`               | -         | Centre/end label               |
| `color` | `string`               | `'green'` | Colour                         |
| `size`  | `'small' \| 'large'`   | `'small'` | Small = 1 line, large = 3 line |

## License

MIT
