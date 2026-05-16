# ink-task-list

A task list component with status indicators and optional output lines, similar to Listr.

## Installation

```bash
npm install @matthesketh/ink-task-list
```

Peer dependencies: `ink` (>=5.0.0), `react` (>=18.0.0), `ink-spinner` (>=5.0.0).

## Usage

```tsx
import React, { useState, useEffect } from 'react';
import { render } from 'ink';
import { TaskList } from '@matthesketh/ink-task-list';
import type { Task } from '@matthesketh/ink-task-list';

function App() {
  const [tasks, setTasks] = useState<Task[]>([
    { label: 'Install dependencies', status: 'success', output: '143 packages' },
    { label: 'Run type check', status: 'running', output: 'Checking 24 files...' },
    { label: 'Run tests', status: 'pending' },
    { label: 'Build artifacts', status: 'pending' },
    { label: 'Optional lint', status: 'skipped' },
  ]);

  return <TaskList tasks={tasks} />;
}

render(<App />);
```

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `tasks` | `Task[]` | **required** | Array of tasks to render. |
| `showOutput` | `boolean` | `true` | Whether to display `task.output` text below each task. |

## Types

### Task

```ts
interface Task {
  label: string;
  status: TaskStatus;
  output?: string;
}
```

### TaskStatus

```ts
type TaskStatus = 'pending' | 'running' | 'success' | 'error' | 'skipped';
```

## Status Indicators

| Status | Indicator | Color |
|--------|-----------|-------|
| `pending` | open circle (U+25CB) | dim |
| `running` | animated spinner (`dots`) | cyan |
| `success` | checkmark (U+2713) | green |
| `error` | cross (U+2717) | red |
| `skipped` | en-dash (U+2013) | dim |

Running tasks have their labels rendered in **bold**.

## Examples

### Hide output lines

```tsx
<TaskList tasks={tasks} showOutput={false} />
```

### Dynamic task progression

```tsx
const [tasks, setTasks] = useState<Task[]>([
  { label: 'Fetch data', status: 'running' },
  { label: 'Process records', status: 'pending' },
]);

useEffect(() => {
  setTimeout(() => {
    setTasks([
      { label: 'Fetch data', status: 'success', output: '200 OK' },
      { label: 'Process records', status: 'running', output: '47/100 records' },
    ]);
  }, 2000);
}, []);
```

## Notes

- The spinner animation is provided by `ink-spinner` with the `dots` type.
- Output lines are indented and rendered with dim color.
- Tasks are keyed by array index, so reordering the array may cause unexpected behavior. Keep task order stable.
