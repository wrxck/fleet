# @matthesketh/ink-chart

Terminal charts for Ink 5 — sparklines, bar charts, and line charts using Unicode block characters.

## Install

```bash
npm install @matthesketh/ink-chart
```

## Components

### Sparkline

Single-row visualization using Unicode block characters (`▁▂▃▄▅▆▇█`).

```tsx
import { Sparkline } from '@matthesketh/ink-chart';

<Sparkline data={[1, 5, 2, 8, 3, 7]} color="green" />
```

| Prop    | Type       | Default         | Description                  |
|---------|------------|-----------------|------------------------------|
| data    | `number[]` | required        | Values to plot               |
| width   | `number`   | `data.length`   | Character width              |
| color   | `string`   | `'green'`       | Text color                   |
| min     | `number`   | auto            | Minimum scale value          |
| max     | `number`   | auto            | Maximum scale value          |

### BarChart

Vertical bar chart with labels and values.

```tsx
import { BarChart } from '@matthesketh/ink-chart';

<BarChart
  data={[
    { label: 'Mon', value: 12 },
    { label: 'Tue', value: 8, color: 'red' },
    { label: 'Wed', value: 15 },
  ]}
  height={10}
/>
```

| Prop       | Type                                              | Default | Description           |
|------------|---------------------------------------------------|---------|-----------------------|
| data       | `{ label: string; value: number; color?: string }[]` | required | Bar data           |
| height     | `number`                                          | `10`    | Chart height in rows  |
| width      | `number`                                          | auto    | Total width           |
| showValues | `boolean`                                         | `true`  | Show value above bars |

### LineChart

Multi-row line chart with optional axes.

```tsx
import { LineChart } from '@matthesketh/ink-chart';

<LineChart data={[1, 3, 2, 5, 4, 7, 6]} width={40} height={10} />
```

| Prop     | Type       | Default  | Description        |
|----------|------------|----------|--------------------|
| data     | `number[]` | required | Values to plot     |
| width    | `number`   | `40`     | Chart width        |
| height   | `number`   | `10`     | Chart height       |
| color    | `string`   | `'cyan'` | Line color         |
| showAxis | `boolean`  | `true`   | Show axes          |
| label    | `string`   | none     | Y-axis label       |

## License

MIT
