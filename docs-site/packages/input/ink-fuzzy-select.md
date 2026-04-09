# ink-fuzzy-select

A fuzzy-searchable select list with keyboard navigation and match highlighting.

## Installation

```bash
npm install @matthesketh/ink-fuzzy-select
```

Peer dependencies: `ink` (>=5.0.0), `react` (>=18.0.0).

## Usage

```tsx
import React from 'react';
import { render } from 'ink';
import { FuzzySelect } from '@matthesketh/ink-fuzzy-select';
import type { FuzzySelectItem } from '@matthesketh/ink-fuzzy-select';

const items: FuzzySelectItem[] = [
  { label: 'United States', value: 'us' },
  { label: 'United Kingdom', value: 'uk' },
  { label: 'Germany', value: 'de' },
  { label: 'France', value: 'fr' },
  { label: 'Australia', value: 'au' },
];

function App() {
  return (
    <FuzzySelect
      items={items}
      onSelect={(item) => {
        console.log(`Selected: ${item.label} (${item.value})`);
        process.exit(0);
      }}
      onCancel={() => process.exit(0)}
    />
  );
}

render(<App />);
```

## Props

### `FuzzySelectProps`

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `items` | `FuzzySelectItem[]` | **(required)** | Array of selectable items. |
| `onSelect` | `(item: FuzzySelectItem) => void` | **(required)** | Callback fired when the user presses Enter on a highlighted item. |
| `onCancel` | `() => void` | `undefined` | Callback fired when the user presses Escape. |
| `placeholder` | `string` | `"Type to filter..."` | Placeholder text shown when the query is empty. |
| `maxVisible` | `number` | `10` | Maximum number of items visible at once. The list scrolls to keep the selected item in view. |
| `renderItem` | `(item, selected, highlighted) => ReactNode` | `undefined` | Custom render function. Receives the item, whether it is selected, and a highlighted label string (matched chars wrapped in `[brackets]`). |

### `FuzzySelectItem`

| Property | Type | Description |
|----------|------|-------------|
| `label` | `string` | Display text (this is what the fuzzy search matches against). |
| `value` | `string` | Unique value returned on selection. |

## Keyboard Controls

| Key | Action |
|-----|--------|
| Any character | Appends to the search query and filters the list. |
| Backspace | Removes the last character from the query. |
| Up Arrow | Move selection up. |
| Down Arrow | Move selection down. |
| Enter | Select the currently highlighted item. |
| Escape | Cancel (calls `onCancel`). |

## Examples

### Custom render item

```tsx
<FuzzySelect
  items={items}
  onSelect={handleSelect}
  renderItem={(item, isSelected, highlighted) => (
    <Text color={isSelected ? 'green' : 'white'}>
      {isSelected ? '* ' : '  '}{highlighted}
    </Text>
  )}
/>
```

### Limiting visible items

```tsx
<FuzzySelect items={longList} maxVisible={5} onSelect={handleSelect} />
```

## Exported Utilities

### `fuzzyMatch(query: string, text: string): FuzzyMatchResult`

The underlying fuzzy matching function is exported for standalone use.

```ts
import { fuzzyMatch } from '@matthesketh/ink-fuzzy-select';

const result = fuzzyMatch('uk', 'United Kingdom');
// { matches: true, score: 5, indices: [0, 7] }
```

**`FuzzyMatchResult`**

| Property | Type | Description |
|----------|------|-------------|
| `matches` | `boolean` | Whether all query characters were found in order. |
| `score` | `number` | Match quality score. Bonus for consecutive matches (+2) and start-of-string matches (+3). |
| `indices` | `number[]` | Character positions in `text` that matched the query. |

## Notes

- Filtering is case-insensitive.
- When the query is empty, all items are shown in their original order.
- Results are sorted by match score (highest first) when a query is active.
- The selected index resets to 0 whenever the query changes.
- The visible window scrolls to keep the selected item centered.
