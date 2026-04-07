# ink-pipeline

A step-by-step pipeline visualisation with status indicators, progress bars, and duration tracking.

## Installation

```bash
npm install @matthesketh/ink-pipeline
```

Peer dependencies: `ink` (>=5.0.0), `react` (>=18.0.0), `ink-spinner`.

## Usage

```tsx
import React, { useState, useEffect } from 'react';
import { render } from 'ink';
import { Pipeline } from '@matthesketh/ink-pipeline';
import type { PipelineStep } from '@matthesketh/ink-pipeline';

function App() {
  const [steps, setSteps] = useState<PipelineStep[]>([
    { label: 'Install dependencies', status: 'success', duration: 4200 },
    { label: 'Run tests', status: 'running', progress: 0.6 },
    { label: 'Build', status: 'pending' },
    { label: 'Deploy', status: 'pending' },
  ]);

  return <Pipeline steps={steps} title="Release Pipeline" />;
}

render(<App />);
```

## Props

### `PipelineProps`

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `steps` | `PipelineStep[]` | **(required)** | Array of pipeline steps to render. |
| `title` | `string` | `undefined` | Optional bold title displayed above the steps. |
| `showDuration` | `boolean` | `true` | Show duration next to completed/running steps when `duration` is set. |
| `showProgress` | `boolean` | `true` | Show a progress bar for running steps when `progress` is set. |
| `compact` | `boolean` | `false` | When `true`, hides step output text and connector lines between steps. |

### `PipelineStep`

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `label` | `string` | **(required)** | Display name of the step. |
| `status` | `StepStatus` | **(required)** | Current status of the step. |
| `progress` | `number` | `undefined` | Progress value between 0 and 1. Only displayed when status is `running` and `showProgress` is `true`. |
| `duration` | `number` | `undefined` | Duration in milliseconds. Formatted automatically (e.g. `420ms`, `4.2s`). |
| `output` | `string` | `undefined` | Extra output text displayed below the step (hidden in compact mode). |

### `StepStatus`

```ts
type StepStatus = 'pending' | 'running' | 'success' | 'error' | 'skipped' | 'rolling-back';
```

| Status | Indicator | Colour |
|--------|-----------|--------|
| `pending` | hollow circle | dim |
| `running` | animated spinner (`dots`) | cyan |
| `success` | checkmark | green |
| `error` | cross | red |
| `skipped` | dash | dim |
| `rolling-back` | loop arrow | yellow |

## Examples

### Compact mode

```tsx
<Pipeline
  steps={steps}
  compact
  showDuration={false}
/>
```

### With step output

```tsx
<Pipeline steps={[
  {
    label: 'Run tests',
    status: 'error',
    duration: 1200,
    output: 'FAIL src/utils.test.ts - Expected 3, received 4',
  },
  { label: 'Deploy', status: 'skipped' },
]} />
```

### Rolling back

```tsx
<Pipeline steps={[
  { label: 'Deploy v2.1', status: 'error', duration: 8500 },
  { label: 'Rollback to v2.0', status: 'rolling-back' },
]} />
```

## Notes

- The progress bar is 8 characters wide and displays a percentage alongside it.
- Duration is formatted as milliseconds below 1000ms and seconds (one decimal) at or above 1000ms.
- The `running` status uses an animated spinner from `ink-spinner` (dots variant).
- The component is display-only and does not handle keyboard input.
