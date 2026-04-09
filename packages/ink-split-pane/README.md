# @matthesketh/ink-split-pane

Resizable side-by-side or top-bottom panel layout for [Ink 5](https://github.com/vadimdemedes/ink).

## Install

```sh
npm install @matthesketh/ink-split-pane
```

## Usage

```tsx
import { SplitPane } from '@matthesketh/ink-split-pane';
import { Text } from 'ink';

// Horizontal (side-by-side)
<SplitPane sizes={[60, 40]}>
  <Text>Left panel</Text>
  <Text>Right panel</Text>
</SplitPane>

// Vertical (top-bottom)
<SplitPane direction="vertical" sizes={[70, 30]}>
  <Text>Top panel</Text>
  <Text>Bottom panel</Text>
</SplitPane>
```

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `direction` | `'horizontal' \| 'vertical'` | `'horizontal'` | Layout direction. Horizontal = side by side, vertical = stacked. |
| `sizes` | `[number, number]` | `[50, 50]` | Percentage split between the two panes. |
| `minSize` | `number` | `5` | Minimum columns (horizontal) or rows (vertical) per pane. |
| `showDivider` | `boolean` | `true` | Whether to render the divider between panes. |
| `dividerChar` | `string` | `'\u2502'` / `'\u2500'` | Character used to draw the divider. |
| `dividerColor` | `string` | `'gray'` | Ink color for the divider. |
| `children` | `[ReactNode, ReactNode]` | required | Exactly two children. |

## License

MIT
