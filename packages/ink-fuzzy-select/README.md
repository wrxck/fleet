# @wrxck/ink-fuzzy-select

Filterable select input with fuzzy matching for [Ink 5](https://github.com/vadimdemedes/ink). Type to filter, arrow keys to navigate, enter to select.

All existing fuzzy-select packages for Ink target Ink 0.x or 2.x and are no longer maintained. This package is built for Ink 5 with React 18.

## Install

```bash
npm install @wrxck/ink-fuzzy-select
```

## Usage

```tsx
import React from "react";
import { render } from "ink";
import { FuzzySelect } from "@wrxck/ink-fuzzy-select";

const items = [
  { label: "JavaScript", value: "js" },
  { label: "TypeScript", value: "ts" },
  { label: "Python", value: "py" },
  { label: "Rust", value: "rs" },
  { label: "Go", value: "go" },
];

function App() {
  return (
    <FuzzySelect
      items={items}
      onSelect={(item) => {
        console.log("Selected:", item.value);
        process.exit(0);
      }}
      onCancel={() => {
        console.log("Cancelled");
        process.exit(0);
      }}
      placeholder="Search languages..."
      maxVisible={5}
    />
  );
}

render(<App />);
```

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `items` | `FuzzySelectItem[]` | (required) | Array of items to select from |
| `onSelect` | `(item: FuzzySelectItem) => void` | (required) | Called when an item is selected with Enter |
| `onCancel` | `() => void` | `undefined` | Called when Escape is pressed |
| `placeholder` | `string` | `"Type to filter..."` | Shown in the input when the query is empty |
| `maxVisible` | `number` | `10` | Maximum number of items visible in the list |
| `renderItem` | `(item, selected, highlighted) => ReactNode` | `undefined` | Custom item renderer |

### FuzzySelectItem

```ts
interface FuzzySelectItem {
  label: string;
  value: string;
}
```

## Keyboard

| Key | Action |
|-----|--------|
| Any character | Appends to the filter query |
| Backspace | Removes the last character from the query |
| Up / Down | Navigate the filtered list |
| Enter | Select the highlighted item |
| Escape | Cancel (calls `onCancel`) |

## Fuzzy matching

The built-in fuzzy matcher checks whether all query characters appear in order in the label (case-insensitive). Results are scored by:

- **Consecutive matches** -- +2 points for each character that immediately follows the previous match
- **Start-of-string** -- +3 points if the first query character matches the first character of the label

Higher-scoring matches appear first in the filtered list.

You can also import the matcher directly:

```ts
import { fuzzyMatch } from "@wrxck/ink-fuzzy-select";

const result = fuzzyMatch("ts", "TypeScript");
// { matches: true, score: 3, indices: [0, 5] }
```

## Custom rendering

Use `renderItem` to control how each item is displayed. The `highlighted` parameter is a string with matched characters wrapped in brackets (e.g. `"[T]ype[S]cript"`).

```tsx
<FuzzySelect
  items={items}
  onSelect={handleSelect}
  renderItem={(item, selected, highlighted) => (
    <Text color={selected ? "green" : "white"}>
      {selected ? "> " : "  "}
      {highlighted} ({item.value})
    </Text>
  )}
/>
```

## Requirements

- Ink >= 5.0.0
- React >= 18.0.0
