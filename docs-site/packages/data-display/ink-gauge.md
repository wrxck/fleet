# ink-gauge

A progress gauge and donut visualisation component for Ink 5 terminal dashboards.

## Installation

```bash
npm install @matthesketh/ink-gauge
```

Peer dependencies: `ink` (>=5.0.0), `react` (>=18.0.0).

## Usage

```tsx
import React from 'react';
import { render, Box, Text } from 'ink';
import { Gauge, Donut } from '@matthesketh/ink-gauge';

function App() {
  return (
    <Box flexDirection="column" gap={1}>
      <Gauge value={72} label="CPU" color="green" />

      <Gauge
        value={90}
        width={30}
        showPercentage={true}
        thresholds={[
          { value: 0, color: 'green' },
          { value: 60, color: 'yellow' },
          { value: 80, color: 'red' },
        ]}
      />

      <Donut value={45} label="Disk" color="cyan" />

      <Donut value={88} size="large" color="magenta" />
    </Box>
  );
}

render(<App />);
```

## Gauge Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `value` | `number` | **(required)** | Percentage value (clamped to 0-100). |
| `width` | `number` | `20` | Number of characters in the bar. |
| `filledChar` | `string` | `"\u2588"` (full block) | Character used for the filled portion. |
| `emptyChar` | `string` | `"\u2591"` (light shade) | Character used for the empty portion. |
| `color` | `string` | `"green"` | Ink colour for the filled portion. |
| `showPercentage` | `boolean` | `true` | Show the percentage number after the bar. |
| `label` | `string` | `undefined` | Optional text label rendered before the bar. |
| `thresholds` | `{ value: number; color: string }[]` | `undefined` | Colour breakpoints. The bar colour changes when `value` >= a threshold's `value`. Thresholds are evaluated in ascending order. |

## Donut Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `value` | `number` | **(required)** | Percentage value (clamped to 0-100). |
| `label` | `string` | `undefined` | Text shown after the gauge. Defaults to the percentage if omitted (small mode only). |
| `color` | `string` | `"green"` | Ink colour for the filled portion / border. |
| `size` | `"small" \| "large"` | `"small"` | `"small"` renders a dot-based inline gauge. `"large"` renders a box with the percentage inside. |

## Examples

### Threshold-based colour

```tsx
<Gauge
  value={cpuPercent}
  label="CPU"
  width={25}
  thresholds={[
    { value: 0, color: 'green' },
    { value: 50, color: 'yellow' },
    { value: 80, color: 'red' },
  ]}
/>
```

The bar will be green at 0-49%, yellow at 50-79%, and red at 80-100%.

### Large donut

```tsx
<Donut value={67} size="large" color="blue" />
```

Renders a bordered box displaying the percentage:

```
  ╭───╮
  │67%│
  ╰───╯
```

## Notes

- Both components clamp `value` to the 0-100 range.
- `Gauge` uses `Math.round` to determine filled characters, so rounding is applied to both the bar and the displayed percentage.
- The `thresholds` array is sorted internally by `value` -- you can pass them in any order.
- `Donut` in small mode falls back to showing the percentage as the label when no `label` prop is provided.
