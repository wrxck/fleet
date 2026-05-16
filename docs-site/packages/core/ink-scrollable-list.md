# ink-scrollable-list

A generic scrollable list component for Ink that virtualizes rendering and follows the selected item.

## Installation

```bash
npm install @matthesketh/ink-scrollable-list
```

## Usage

```tsx
import { ScrollableList } from '@matthesketh/ink-scrollable-list';

const items = ['alpha', 'bravo', 'charlie', 'delta', 'echo'];

function App() {
  const [selected, setSelected] = useState(0);

  return (
    <ScrollableList
      items={items}
      selectedIndex={selected}
      maxVisible={3}
      renderItem={(item, isSelected) => (
        <Text color={isSelected ? 'cyan' : undefined}>
          {isSelected ? '>' : ' '} {item}
        </Text>
      )}
    />
  );
}
```

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `items` | `T[]` | *(required)* | The full array of items to display. |
| `selectedIndex` | `number` | *(required)* | Index of the currently selected item. The viewport scrolls to keep this item visible. |
| `maxVisible` | `number` | *(required)* | Maximum number of items to render at once. Items outside this window are not rendered. |
| `renderItem` | `(item: T, selected: boolean, index: number) => React.ReactNode` | *(required)* | Render function called for each visible item. Receives the item, whether it is selected, and its index in the full list. |
| `emptyText` | `string` | `'No items'` | Text displayed (dimmed) when `items` is empty. |

## Examples

### Basic navigation

```tsx
import { ScrollableList } from '@matthesketh/ink-scrollable-list';
import { useInput } from 'ink';

function FileList({ files }: { files: string[] }) {
  const [selected, setSelected] = useState(0);

  useInput((_, key) => {
    if (key.downArrow) setSelected((s) => Math.min(s + 1, files.length - 1));
    if (key.upArrow) setSelected((s) => Math.max(s - 1, 0));
  });

  return (
    <ScrollableList
      items={files}
      selectedIndex={selected}
      maxVisible={10}
      renderItem={(file, isSelected) => (
        <Text color={isSelected ? 'green' : 'white'}>
          {isSelected ? '>' : ' '} {file}
        </Text>
      )}
    />
  );
}
```

### With viewport integration

```tsx
import { Viewport, useAvailableHeight } from '@matthesketh/ink-viewport';
import { ScrollableList } from '@matthesketh/ink-scrollable-list';

function App() {
  const height = useAvailableHeight();

  return (
    <ScrollableList
      items={services}
      selectedIndex={selected}
      maxVisible={height - 2}
      renderItem={(svc, sel) => (
        <Text color={sel ? 'cyan' : undefined}>{svc.name}</Text>
      )}
    />
  );
}
```

## Notes

- Scroll indicators appear automatically: an up arrow with count when items are hidden above, and a down arrow with count when items are hidden below.
- The component is generic (`ScrollableList<T>`) so items can be any type.
- The `selectedIndex` is clamped to `items.length - 1` internally, so it will not go out of bounds.
- The visible window, scroll offset, and indicator state are computed in a single `useMemo` for performance.
