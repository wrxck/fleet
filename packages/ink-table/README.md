# @matthesketh/ink-table

Modern table component for [Ink 5](https://github.com/vadimdemedes/ink) with column alignment, truncation, row selection highlighting, and windowed scrolling.

The existing `ink-table` on npm targets Ink 3.x and is no longer maintained. This package is a ground-up replacement for Ink 5.

## Install

```bash
npm install @matthesketh/ink-table
```

## Usage

```tsx
import React, { useState } from 'react';
import { render } from 'ink';
import { Table, type Column } from '@matthesketh/ink-table';

interface Service {
  name: string;
  status: string;
  cpu: number;
}

const columns: Column<Service>[] = [
  { key: 'name', header: 'Service', width: 20 },
  { key: 'status', header: 'Status' },
  { key: 'cpu', header: 'CPU %', align: 'right', width: 8 },
];

const data: Service[] = [
  { name: 'api-gateway', status: 'running', cpu: 12.4 },
  { name: 'auth-service', status: 'running', cpu: 3.1 },
  { name: 'worker', status: 'stopped', cpu: 0 },
];

function App() {
  const [selected, setSelected] = useState(0);

  return (
    <Table
      data={data}
      columns={columns}
      selectedIndex={selected}
      maxVisible={10}
      borderStyle="single"
    />
  );
}

render(<App />);
```

## Props

### `TableProps<T>`

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `data` | `T[]` | *required* | Array of row objects |
| `columns` | `Column<T>[]` | *required* | Column definitions |
| `selectedIndex` | `number` | `undefined` | Index of highlighted row (bold + cyan). Omit for no selection. |
| `maxVisible` | `number` | `undefined` | Maximum visible rows. Enables windowed scrolling with indicators. |
| `emptyText` | `string` | `'No data'` | Text shown when `data` is empty |
| `borderStyle` | `'single' \| 'none'` | `'single'` | `'single'` draws box-drawing separators; `'none'` uses spaces |

### `Column<T>`

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `key` | `keyof T & string` | *required* | Property name to read from each row |
| `header` | `string` | *required* | Column header text |
| `width` | `number` | auto | Fixed column width. Auto-calculated from content if omitted (capped at 30). |
| `align` | `'left' \| 'right' \| 'center'` | `'left'` | Text alignment within the column |
| `render` | `(value, row) => ReactNode` | `undefined` | Custom cell renderer |

## Features

- **Auto column widths** -- calculated from header and data content, capped at 30 characters
- **Truncation** -- cells exceeding column width are truncated with an ellipsis character
- **Alignment** -- left, right, or center alignment per column
- **Row selection** -- highlighted row rendered in bold cyan
- **Windowed scrolling** -- follow-cursor algorithm with scroll indicators when `maxVisible` is set
- **Custom renderers** -- per-column `render` function for custom cell content
- **Border styles** -- box-drawing characters or plain spaces

## Requirements

- Node.js >= 20
- Ink >= 5.0.0
- React >= 18.0.0
