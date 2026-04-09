# ink-tree

Collapsible tree view component for Ink 5 with keyboard navigation and custom rendering.

## Installation

```bash
npm install @matthesketh/ink-tree
```

Peer dependencies: `ink` (>=5.0.0), `react` (>=18.0.0).

## Usage

```tsx
import React, { useState } from 'react';
import { render, Box } from 'ink';
import { Tree } from '@matthesketh/ink-tree';
import type { TreeNode } from '@matthesketh/ink-tree';

const data: TreeNode[] = [
  {
    id: 'src',
    label: 'src/',
    children: [
      { id: 'index', label: 'index.ts' },
      {
        id: 'components',
        label: 'components/',
        children: [
          { id: 'app', label: 'App.tsx' },
          { id: 'header', label: 'Header.tsx' },
        ],
      },
    ],
  },
  { id: 'readme', label: 'README.md' },
];

function App() {
  const [selected, setSelected] = useState('src');
  const [expanded, setExpanded] = useState(new Set(['src', 'components']));

  return (
    <Tree
      nodes={data}
      selectedId={selected}
      expandedIds={expanded}
      maxVisible={10}
    />
  );
}

render(<App />);
```

## TreeNode Type

```ts
interface TreeNode {
  id: string;
  label: string;
  children?: TreeNode[];
  data?: unknown;
}
```

## Tree Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `nodes` | `TreeNode[]` | **(required)** | The root-level tree nodes. |
| `selectedId` | `string` | `undefined` | ID of the currently selected node. The selected node is rendered bold and cyan by default. |
| `expandedIds` | `Set<string>` | `new Set()` | Set of node IDs whose children are visible. |
| `maxVisible` | `number` | `undefined` | Maximum number of visible rows. Enables scrolling with "N more above/below" indicators. |
| `renderNode` | `(node: TreeNode, depth: number, selected: boolean, expanded: boolean) => React.ReactNode` | Default renderer | Custom render function for each node. |
| `indent` | `number` | `2` | Number of spaces per indentation level for root nodes. |

## Examples

### Custom node renderer

```tsx
import { Text } from 'ink';
import { Tree } from '@matthesketh/ink-tree';
import type { TreeNode } from '@matthesketh/ink-tree';

<Tree
  nodes={data}
  selectedId={selectedId}
  expandedIds={expandedIds}
  renderNode={(node: TreeNode, depth: number, selected: boolean) => (
    <Text color={selected ? 'yellow' : 'white'}>
      {selected ? '>> ' : '   '}{node.label}
    </Text>
  )}
/>
```

### Using flattenTree directly

The `flattenTree` utility is exported for cases where you need the flat list without the component:

```ts
import { flattenTree } from '@matthesketh/ink-tree';
import type { FlatNode } from '@matthesketh/ink-tree';

const flat: FlatNode[] = flattenTree(nodes, expandedIds);
```

Each `FlatNode` contains:

| Field | Type | Description |
|-------|------|-------------|
| `node` | `TreeNode` | The original tree node. |
| `depth` | `number` | Nesting depth (0 for root). |
| `isLast` | `boolean` | Whether this is the last sibling at its level. |
| `hasChildren` | `boolean` | Whether the node has children. |
| `expanded` | `boolean` | Whether the node is currently expanded. |
| `ancestors` | `boolean[]` | For each ancestor level, whether that ancestor was the last child (used for drawing connectors). |

## Notes

- The tree renders Unicode box-drawing connectors (`\u251c\u2500`, `\u2514\u2500`, `\u2502`) for structure lines.
- Leaf nodes show a centre dot indicator, expanded nodes show a down-pointing triangle, and collapsed nodes show a right-pointing triangle.
- When `maxVisible` is set and the list overflows, scroll indicators display the count of hidden items above and below the viewport.
- The component does not handle keyboard input itself. Wire up your own input handler (e.g. via `@matthesketh/ink-input-dispatcher`) to toggle `expandedIds` and update `selectedId`.
- An empty `nodes` array renders a dimmed "No items" message.
