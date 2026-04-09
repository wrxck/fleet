# @matthesketh/ink-tree

A collapsible tree view component for [Ink 5](https://github.com/vadimdemedes/ink). Displays hierarchical data with expand/collapse, keyboard navigation, and custom rendering.

## Install

```bash
npm install @matthesketh/ink-tree
```

## Usage

```tsx
import React, { useState } from 'react';
import { render } from 'ink';
import { Tree, type TreeNode } from '@matthesketh/ink-tree';

const data: TreeNode[] = [
  {
    id: 'src',
    label: 'src',
    children: [
      { id: 'index', label: 'index.ts' },
      {
        id: 'components',
        label: 'components',
        children: [
          { id: 'app', label: 'App.tsx' },
          { id: 'header', label: 'Header.tsx' },
        ],
      },
    ],
  },
];

function App() {
  const [expanded, setExpanded] = useState(new Set(['src', 'components']));
  const [selected, setSelected] = useState('index');

  return (
    <Tree
      nodes={data}
      expandedIds={expanded}
      selectedId={selected}
      maxVisible={10}
    />
  );
}

render(<App />);
```

## API

### `TreeNode`

```ts
interface TreeNode {
  id: string;
  label: string;
  children?: TreeNode[];
  data?: unknown;
}
```

### `TreeProps`

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `nodes` | `TreeNode[]` | required | Tree data |
| `selectedId` | `string` | - | Highlighted node id |
| `expandedIds` | `Set<string>` | `new Set()` | Which nodes are expanded |
| `maxVisible` | `number` | - | Windowed display limit |
| `renderNode` | `(node, depth, selected, expanded) => ReactNode` | default renderer | Custom node renderer |
| `indent` | `number` | `2` | Spaces per indentation level |

### `flattenTree`

```ts
function flattenTree(nodes: TreeNode[], expandedIds: Set<string>): FlatNode[];
```

Utility to flatten a tree into a visible list based on expanded state. Useful for building custom tree implementations.

## Visual

Collapsed tree shows indicator arrows for expandable nodes and dot for leaves, with tree connector lines for hierarchy.

## License

MIT
