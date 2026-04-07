# ink-split-pane

A split pane layout component for Ink that divides the terminal into two panels, either horizontally (side-by-side) or vertically (stacked).

## Installation

```bash
npm install @matthesketh/ink-split-pane
```

## Usage

```tsx
import { SplitPane } from '@matthesketh/ink-split-pane';

function App() {
  return (
    <SplitPane direction="horizontal" sizes={[30, 70]}>
      <Sidebar />
      <MainContent />
    </SplitPane>
  );
}
```

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `direction` | `'horizontal' \| 'vertical'` | `'horizontal'` | Layout direction. `horizontal` places panes side-by-side; `vertical` stacks them top-to-bottom. |
| `sizes` | `[number, number]` | `[50, 50]` | Ratio of space allocated to each pane. Values are proportional (e.g. `[30, 70]` gives 30% and 70%). |
| `minSize` | `number` | `5` | Minimum number of columns (horizontal) or rows (vertical) for each pane. |
| `showDivider` | `boolean` | `true` | Whether to render a divider line between the two panes. |
| `dividerChar` | `string` | `'\u2502'` (horizontal) / `'\u2500'` (vertical) | Character used to draw the divider. Defaults to a vertical line for horizontal splits and a horizontal line for vertical splits. |
| `dividerColor` | `string` | `'gray'` | Ink color string applied to the divider. |
| `children` | `[React.ReactNode, React.ReactNode]` | *(required)* | Exactly two children representing the left/right (horizontal) or top/bottom (vertical) panes. |

## Examples

### Horizontal split with custom ratio

```tsx
<SplitPane direction="horizontal" sizes={[25, 75]}>
  <Box flexDirection="column">
    <Text bold>Sidebar</Text>
    <Text>Navigation items...</Text>
  </Box>
  <Box flexDirection="column">
    <Text bold>Main Panel</Text>
    <Text>Content goes here</Text>
  </Box>
</SplitPane>
```

### Vertical split (top/bottom)

```tsx
<SplitPane direction="vertical" sizes={[70, 30]}>
  <Box>
    <Text>Main content area</Text>
  </Box>
  <Box>
    <Text>Log output panel</Text>
  </Box>
</SplitPane>
```

### No divider

```tsx
<SplitPane showDivider={false} sizes={[50, 50]}>
  <LeftPanel />
  <RightPanel />
</SplitPane>
```

### Custom divider styling

```tsx
<SplitPane dividerChar=":" dividerColor="cyan" sizes={[40, 60]}>
  <PanelA />
  <PanelB />
</SplitPane>
```

## Notes

- Pane sizes are computed from `process.stdout.columns` (horizontal) or `process.stdout.rows` (vertical), falling back to 80 columns and 24 rows.
- The divider occupies 1 column or 1 row. Available space is the terminal dimension minus the divider size.
- The `minSize` constraint is enforced after ratio calculation. If one pane is below `minSize`, it is forced to `minSize` and the other pane gets the remaining space.
- Both panes have `overflow="hidden"` set, so content that exceeds the pane dimensions is clipped.
- The `children` prop must be a tuple of exactly two elements.
