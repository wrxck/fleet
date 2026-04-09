# ink-chart

A collection of terminal chart components for Ink: bar charts, line charts, and sparklines rendered with Unicode block and box-drawing characters.

## Installation

```bash
npm install @matthesketh/ink-chart
```

## Components

### BarChart

A vertical bar chart rendered with full-block Unicode characters.

```tsx
import { BarChart } from '@matthesketh/ink-chart';

<BarChart
  data={[
    { label: 'api', value: 120, color: 'green' },
    { label: 'web', value: 85, color: 'cyan' },
    { label: 'db', value: 200, color: 'yellow' },
  ]}
  height={8}
/>
```

#### `BarChartProps`

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `data` | `BarChartDatum[]` | *(required)* | Array of data points. Each has `label` (string), `value` (number), and optional `color` (string). |
| `height` | `number` | `10` | Height of the chart in rows. |
| `width` | `number` | `undefined` | Currently accepted but unused in rendering. |
| `showValues` | `boolean` | `true` | Whether to display numeric values above the bars. |

#### `BarChartDatum`

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `label` | `string` | *(required)* | Text label shown below the bar. |
| `value` | `number` | *(required)* | Numeric value determining bar height. |
| `color` | `string` | `'green'` | Ink color applied to the bar and its value label. |

---

### LineChart

An ASCII-style line chart with optional axis labels, rendered using box-drawing characters.

```tsx
import { LineChart } from '@matthesketh/ink-chart';

<LineChart
  data={[10, 25, 18, 30, 22, 45, 38]}
  width={40}
  height={10}
  color="cyan"
  showAxis={true}
  label="Requests/sec"
/>
```

#### `LineChartProps`

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `data` | `number[]` | *(required)* | Array of numeric data points to plot. |
| `width` | `number` | `40` | Width of the chart area in columns (data is resampled to fit). |
| `height` | `number` | `10` | Height of the chart area in rows. |
| `color` | `string` | `'cyan'` | Ink color applied to the chart line. |
| `showAxis` | `boolean` | `true` | Whether to render Y-axis labels and an X-axis line. |
| `label` | `string` | `undefined` | Optional label displayed above the chart (only shown when `showAxis` is `true`). |

---

### Sparkline

A compact single-line chart using Unicode block elements (U+2581 through U+2588) to visualize data trends.

```tsx
import { Sparkline } from '@matthesketh/ink-chart';

<Sparkline data={[1, 5, 3, 8, 2, 7, 4, 6]} color="green" />
```

#### `SparklineProps`

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `data` | `number[]` | *(required)* | Array of numeric data points. |
| `width` | `number` | `data.length` | Display width in characters. Data is resampled to fit if the width differs from data length. |
| `color` | `string` | `'green'` | Ink color applied to the sparkline. |
| `min` | `number` | *auto (min of data)* | Override the minimum value for normalization. |
| `max` | `number` | *auto (max of data)* | Override the maximum value for normalization. |

## Examples

### Dashboard with multiple chart types

```tsx
import { BarChart, LineChart, Sparkline } from '@matthesketh/ink-chart';
import { Box, Text } from 'ink';

function Dashboard() {
  return (
    <Box flexDirection="column" gap={1}>
      <Box flexDirection="column">
        <Text bold>Request Volume</Text>
        <LineChart data={requestHistory} width={50} height={8} label="req/s" />
      </Box>

      <Box flexDirection="column">
        <Text bold>Service Load</Text>
        <BarChart
          data={[
            { label: 'api', value: 78, color: 'green' },
            { label: 'web', value: 92, color: 'red' },
            { label: 'auth', value: 45, color: 'cyan' },
          ]}
          height={6}
        />
      </Box>

      <Box>
        <Text>CPU: </Text>
        <Sparkline data={cpuHistory} width={20} color="yellow" />
        <Text>  Mem: </Text>
        <Sparkline data={memHistory} width={20} color="magenta" />
      </Box>
    </Box>
  );
}
```

### Sparkline with fixed scale

```tsx
<Sparkline data={percentages} width={30} color="blue" min={0} max={100} />
```

### Line chart without axis

```tsx
<LineChart data={values} width={30} height={5} showAxis={false} color="green" />
```

## Notes

- All components return empty `<Text>` when given an empty `data` array.
- `BarChart` scales bar heights relative to the maximum value in the dataset. A zero maximum results in all bars having zero height.
- `LineChart` resamples data to fit the specified `width` using nearest-neighbor sampling. It uses box-drawing characters for slopes and a middle dot for peaks and valleys.
- `Sparkline` maps values to 8 Unicode block characters (U+2581-U+2588). When all values are equal, the mid-level block is used. Override `min`/`max` to fix the normalization range across multiple sparklines.
- The Y-axis label width on `LineChart` is computed from the longest of the max value, min value, and label string.
