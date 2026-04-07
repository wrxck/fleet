# @wrxck/ink-pager

A less-like scrollable content viewer for Ink 5. Displays multi-line text content with keyboard scrolling, line numbers, and search.

## Install

```bash
npm install @wrxck/ink-pager
```

## Usage

```tsx
import { Pager } from '@wrxck/ink-pager';

function App() {
  const [offset, setOffset] = useState(0);

  return (
    <Pager
      content={logOutput}
      height={20}
      showLineNumbers
      searchQuery="error"
      scrollOffset={offset}
      onScroll={setOffset}
    />
  );
}
```

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `content` | `string` | required | The text to display |
| `height` | `number` | required | Visible rows |
| `showLineNumbers` | `boolean` | `false` | Show line numbers on the left |
| `wrap` | `boolean` | `true` | Word wrap long lines |
| `searchQuery` | `string` | - | Highlight matches in yellow/bold |
| `scrollOffset` | `number` | `0` | Controlled scroll position |
| `onScroll` | `(offset: number) => void` | - | Scroll position callback |

## Behaviour

- Splits content into lines, renders a window of `height` lines starting from `scrollOffset`
- Line numbers shown in dim colour on the left when enabled
- Word wrap splits long lines to fit terminal width
- Search query highlights matches in yellow/bold
- Shows scroll position indicator: `Line X-Y of Z` at bottom
- Presentational component only; parent controls `scrollOffset`
