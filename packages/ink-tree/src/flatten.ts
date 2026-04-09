export interface TreeNode {
  id: string;
  label: string;
  children?: TreeNode[];
  data?: unknown;
}

export interface FlatNode {
  node: TreeNode;
  depth: number;
  isLast: boolean;
  hasChildren: boolean;
  expanded: boolean;
  // whether each ancestor is the last child at its level (for drawing connectors)
  ancestors: boolean[];
}

export function flattenTree(
  nodes: TreeNode[],
  expandedIds: Set<string>,
  ancestors: boolean[] = [],
): FlatNode[] {
  const result: FlatNode[] = [];
  const depth = ancestors.length;

  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i]!;
    const isLast = i === nodes.length - 1;
    const hasChildren = (node.children?.length ?? 0) > 0;
    const expanded = hasChildren && expandedIds.has(node.id);

    result.push({
      node,
      depth,
      isLast,
      hasChildren,
      expanded,
      ancestors: [...ancestors],
    });

    if (expanded && node.children) {
      const childAncestors = [...ancestors, isLast];
      result.push(...flattenTree(node.children, expandedIds, childAncestors));
    }
  }

  return result;
}
