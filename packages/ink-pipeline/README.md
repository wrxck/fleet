# @matthesketh/ink-pipeline

A multi-step process/pipeline visualisation component for [Ink 5](https://github.com/vadimdemedes/ink). Shows sequential steps with individual status, progress, timing, and rollback indication. Perfect for deploy workflows, CI pipelines, and setup wizards.

## Install

```sh
npm install @matthesketh/ink-pipeline
```

Peer dependencies: `ink 5.2.1` and `react 18.3.1`.

## Usage

```tsx
import React from 'react';
import { render } from 'ink';
import { Pipeline } from '@matthesketh/ink-pipeline';

function App() {
  return (
    <Pipeline
      title="Deploy Pipeline"
      steps={[
        { label: 'Install deps', status: 'success', duration: 1200 },
        { label: 'Build', status: 'running', progress: 0.45 },
        { label: 'Deploy', status: 'pending' },
        { label: 'Health check', status: 'pending' },
      ]}
    />
  );
}

render(<App />);
```

Output:

```
Deploy Pipeline
[ok] Install deps (1.2s)
 |
[..] Build [====    ] 45%
 |
[ ] Deploy
 |
[ ] Health check
```

## API

### `<Pipeline>`

| Prop           | Type             | Default | Description                                  |
| -------------- | ---------------- | ------- | -------------------------------------------- |
| `steps`        | `PipelineStep[]` | -       | Array of steps to display                    |
| `title`        | `string`         | -       | Optional title shown above the pipeline      |
| `showDuration` | `boolean`        | `true`  | Show elapsed time next to completed steps    |
| `showProgress` | `boolean`        | `true`  | Show progress bar for running steps          |
| `compact`      | `boolean`        | `false` | Compact mode: one line per step, no connectors |

### `PipelineStep`

| Field      | Type         | Description                                |
| ---------- | ------------ | ------------------------------------------ |
| `label`    | `string`     | Step name                                  |
| `status`   | `StepStatus` | Current step status                        |
| `progress` | `number`     | 0-1, shown as percentage when running      |
| `duration` | `number`     | Milliseconds, shown as elapsed time        |
| `output`   | `string`     | Detail text shown below the step           |

### `StepStatus`

`'pending' | 'running' | 'success' | 'error' | 'skipped' | 'rolling-back'`

Status indicators: `(pending)` pending, spinner running, `(success)` success, `(error)` error, `(skipped)` skipped, `(rolling-back)` rolling-back.

## License

MIT
