# @wrxck/ink-scrollable-list

Windowed scrollable list component for Ink 5. Renders only visible items, follows the cursor, shows scroll indicators.

## Install

```bash
npm install @wrxck/ink-scrollable-list
```

## Usage

```tsx
import { ScrollableList } from '@wrxck/ink-scrollable-list';

function MyList() {
  const [selectedIndex, setSelectedIndex] = useState(0);

  return (
    <ScrollableList
      items={items}
      selectedIndex={selectedIndex}
      maxVisible={15}
      renderItem={(item, selected) => (
        <Text bold={selected} color={selected ? 'cyan' : 'white'}>
          {selected ? '> ' : '  '}{item.name}
        </Text>
      )}
      emptyText="No items found"
    />
  );
}
```

## Props

| Prop | Type | Description |
|------|------|-------------|
| `items` | `T[]` | Array of items to render |
| `selectedIndex` | `number` | Currently selected index |
| `maxVisible` | `number` | Max items visible at once |
| `renderItem` | `(item, selected, index) => ReactNode` | Render function per item |
| `emptyText` | `string?` | Text shown when items is empty |

## Requirements

- Ink >= 5.0.0
- React >= 18.0.0
