# @wrxck/ink-task-list

A step/task progress display component for [Ink 5](https://github.com/vadimdemedes/ink). Shows a list of tasks with status indicators (spinner, checkmark, error, pending).

## Install

```sh
npm install @wrxck/ink-task-list
```

## Usage

```tsx
import React from 'react';
import { render } from 'ink';
import { TaskList } from '@wrxck/ink-task-list';

function App() {
  return (
    <TaskList
      tasks={[
        { label: 'Install dependencies', status: 'success' },
        { label: 'Build project', status: 'running' },
        { label: 'Run tests', status: 'pending' },
      ]}
    />
  );
}

render(<App />);
```

## API

### `<TaskList>`

| Prop         | Type     | Default | Description                        |
|--------------|----------|---------|------------------------------------|
| `tasks`      | `Task[]` | —       | Array of tasks to display          |
| `showOutput` | `boolean`| `true`  | Whether to show task output lines  |

### `Task`

| Property | Type         | Description                            |
|----------|--------------|----------------------------------------|
| `label`  | `string`     | Task label text                        |
| `status` | `TaskStatus` | One of: `pending`, `running`, `success`, `error`, `skipped` |
| `output` | `string?`    | Optional output shown below the task   |

### Status indicators

| Status    | Indicator | Style      |
|-----------|-----------|------------|
| `pending` | `○`       | dim        |
| `running` | spinner   | cyan, bold label |
| `success` | `✓`       | green      |
| `error`   | `✗`       | red        |
| `skipped` | `–`       | dim        |

## License

MIT
