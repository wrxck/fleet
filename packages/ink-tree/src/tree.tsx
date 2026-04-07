import React, { useMemo } from 'react';

import { Box, Text } from 'ink';

import { flattenTree, type TreeNode, type FlatNode } from './flatten.js';

export type { TreeNode } from './flatten.js';

export interface TreeProps {
  nodes: TreeNode[];
  selectedId?: string;
  expandedIds?: Set<string>;
  maxVisible?: number;
  renderNode?: (node: TreeNode, depth: number, selected: boolean, expanded: boolean) => React.ReactNode;
  indent?: number;
}

const INDICATOR_EXPANDED = '\u25bc';
const INDICATOR_COLLAPSED = '\u25b6';
const INDICATOR_LEAF = '\u00b7';
const CONNECTOR_MID = '\u251c\u2500';
const CONNECTOR_LAST = '\u2514\u2500';
const CONNECTOR_PIPE = '\u2502 ';

function defaultRenderNode(node: TreeNode, _depth: number, selected: boolean, _expanded: boolean): React.ReactNode {
  return <Text bold={selected} color={selected ? 'cyan' : undefined}>{node.label}</Text>;
}

function getIndicator(flat: FlatNode): string {
  if (!flat.hasChildren) return INDICATOR_LEAF;
  return flat.expanded ? INDICATOR_EXPANDED : INDICATOR_COLLAPSED;
}

function getPrefix(flat: FlatNode): string {
  if (flat.depth === 0) return '';

  let prefix = '';
  // build connector lines for ancestors
  for (let i = 0; i < flat.ancestors.length; i++) {
    prefix += flat.ancestors[i] ? '  ' : CONNECTOR_PIPE;
  }

  // connector for this node
  prefix += flat.isLast ? CONNECTOR_LAST : CONNECTOR_MID;

  return prefix;
}

export function Tree({
  nodes,
  selectedId,
  expandedIds = new Set<string>(),
  maxVisible,
  renderNode = defaultRenderNode,
  indent = 2,
}: TreeProps): React.JSX.Element {
  const flatList = useMemo(
    () => flattenTree(nodes, expandedIds),
    [nodes, expandedIds],
  );

  const selectedIndex = useMemo(() => {
    if (!selectedId) return -1;
    return flatList.findIndex((f) => f.node.id === selectedId);
  }, [flatList, selectedId]);

  const { visibleItems, scrollOffset, hasAbove, hasBelow } = useMemo(() => {
    if (!maxVisible || maxVisible >= flatList.length) {
      return { visibleItems: flatList, scrollOffset: 0, hasAbove: false, hasBelow: false };
    }

    const displayRows = Math.min(maxVisible, flatList.length);
    let offset = 0;

    const clampedIndex = selectedIndex >= 0 ? Math.min(selectedIndex, flatList.length - 1) : 0;

    if (clampedIndex >= offset + displayRows) {
      offset = clampedIndex - displayRows + 1;
    }
    if (clampedIndex < offset) {
      offset = clampedIndex;
    }

    offset = Math.max(0, Math.min(offset, flatList.length - displayRows));

    return {
      visibleItems: flatList.slice(offset, offset + displayRows),
      scrollOffset: offset,
      hasAbove: offset > 0,
      hasBelow: offset + displayRows < flatList.length,
    };
  }, [flatList, selectedIndex, maxVisible]);

  if (flatList.length === 0) {
    return <Text dimColor>No items</Text>;
  }

  return (
    <Box flexDirection="column">
      {hasAbove && (
        <Text dimColor>  {'\u2191'} {scrollOffset} more above</Text>
      )}
      {visibleItems.map((flat) => {
        const selected = flat.node.id === selectedId;
        const indicator = getIndicator(flat);
        const prefix = getPrefix(flat);
        const depthPad = flat.depth === 0 ? ' '.repeat(flat.depth * indent) : '';

        return (
          <Box key={flat.node.id}>
            <Text>{depthPad}{prefix}{indicator} </Text>
            {renderNode(flat.node, flat.depth, selected, flat.expanded)}
          </Box>
        );
      })}
      {hasBelow && (
        <Text dimColor>  {'\u2193'} {flatList.length - scrollOffset - visibleItems.length} more below</Text>
      )}
    </Box>
  );
}
