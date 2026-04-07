# ink-table

A typed, scrollable table component for Ink with auto-sized columns, alignment, custom cell rendering, and row selection highlighting.

## Installation

```bash
npm install @matthesketh/ink-table
```

## Usage

```tsx
import { Table } from '@matthesketh/ink-table';
import type { Column } from '@matthesketh/ink-table';

interface Service {
  name: string;
  status: string;
  port: number;
}

const columns: Column<Service>[] = [
  { key: 'name', header: 'Name', width: 20 },
  { key: 'status', header: 'Status' },
  { key: 'port', header: 'Port', align: 'right' },
];

const data: Service[] = [
  { name: 'api', status: 'running', port: 3000 },
  { name: 'web', status: 'stopped', port: 8080 },
  { name: 'worker', status: 'running', port: 9090 },
];

function App() {
  return <Table data={data} columns={columns} selectedIndex={0} />;
}
```

## Props

### `TableProps<T>`

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `data` | `T[]` | *(required)* | Array of row objects to display. |
| `columns` | `Column<T>[]` | *(required)* | Column definitions (see below). |
| `selectedIndex` | `number` | `undefined` | Index of the selected row. When set, the selected row is rendered bold and cyan. |
| `maxVisible` | `number` | `undefined` | Maximum number of data rows to render. When set, the table scrolls to keep `selectedIndex` in view. If omitted, all rows are shown. |
| `emptyText` | `string` | `'No data'` | Text displayed (dimmed) when `data` is empty. |
| `borderStyle` | `'single' \| 'none'` | `'single'` | Border style. `single` draws vertical separators between columns and a horizontal divider below the header. `none` uses plain spacing. |

### `Column<T>`

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `key` | `keyof T & string` | *(required)* | The property name on `T` to use for this column's data. |
| `header` | `string` | *(required)* | Header text displayed at the top of the column. |
| `width` | `number` | *auto* | Fixed column width in characters. If omitted, auto-sized to the longest value or header (capped at 30 characters). |
| `align` | `'left' \| 'right' \| 'center'` | `'left'` | Text alignment within the column. |
| `render` | `(value: T[keyof T], row: T) => React.ReactNode` | `undefined` | Custom render function for cells in this column. Receives the cell value and the full row. |

## Examples

### With custom cell rendering

```tsx
const columns: Column<Service>[] = [
  { key: 'name', header: 'Service', width: 20 },
  {
    key: 'status',
    header: 'Status',
    render: (value) => (
      <Text color={value === 'running' ? 'green' : 'red'}>
        {value === 'running' ? '\u25cf' : '\u25cb'} {String(value)}
      </Text>
    ),
  },
  { key: 'port', header: 'Port', align: 'right', width: 6 },
];

<Table data={services} columns={columns} />
```

### Scrollable table with selection

```tsx
function ServiceTable({ services }: { services: Service[] }) {
  const [selected, setSelected] = useState(0);

  useInput((_, key) => {
    if (key.downArrow) setSelected((s) => Math.min(s + 1, services.length - 1));
    if (key.upArrow) setSelected((s) => Math.max(s - 1, 0));
  });

  return (
    <Table
      data={services}
      columns={columns}
      selectedIndex={selected}
      maxVisible={10}
    />
  );
}
```

### No borders

```tsx
<Table data={data} columns={columns} borderStyle="none" />
```

## Notes

- Auto-width columns scan all data values and the header text, then cap at 30 characters. Values longer than the column width are truncated with an ellipsis character.
- When `borderStyle` is `'single'`, columns are separated by ` \u2502 ` and a `\u2500\u253C\u2500` divider is drawn below the header row.
- Scroll indicators (up/down arrows with counts) appear automatically when `maxVisible` is set and there are hidden rows.
- The `selectedIndex` row is rendered with bold cyan text. Rows without selection use default text styling.
- `null` and `undefined` cell values are rendered as empty strings.
