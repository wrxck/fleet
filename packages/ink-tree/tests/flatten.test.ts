import { describe, it, expect } from 'vitest';

import { flattenTree, type TreeNode } from '../src/flatten.js';

const tree: TreeNode[] = [
  {
    id: 'root',
    label: 'Root',
    children: [
      { id: 'a', label: 'A' },
      {
        id: 'b',
        label: 'B',
        children: [
          { id: 'b1', label: 'B1' },
          { id: 'b2', label: 'B2' },
        ],
      },
      { id: 'c', label: 'C' },
    ],
  },
];

describe('flattenTree', () => {
  it('flattens tree correctly with all expanded', () => {
    const expanded = new Set(['root', 'b']);
    const flat = flattenTree(tree, expanded);

    expect(flat.map((f) => f.node.id)).toEqual(['root', 'a', 'b', 'b1', 'b2', 'c']);
  });

  it('respects expanded state - hides unexpanded children', () => {
    const expanded = new Set(['root']);
    const flat = flattenTree(tree, expanded);

    expect(flat.map((f) => f.node.id)).toEqual(['root', 'a', 'b', 'c']);
    expect(flat.find((f) => f.node.id === 'b1')).toBeUndefined();
  });

  it('calculates depth correctly', () => {
    const expanded = new Set(['root', 'b']);
    const flat = flattenTree(tree, expanded);

    expect(flat.find((f) => f.node.id === 'root')!.depth).toBe(0);
    expect(flat.find((f) => f.node.id === 'a')!.depth).toBe(1);
    expect(flat.find((f) => f.node.id === 'b')!.depth).toBe(1);
    expect(flat.find((f) => f.node.id === 'b1')!.depth).toBe(2);
    expect(flat.find((f) => f.node.id === 'b2')!.depth).toBe(2);
    expect(flat.find((f) => f.node.id === 'c')!.depth).toBe(1);
  });

  it('marks last children correctly', () => {
    const expanded = new Set(['root', 'b']);
    const flat = flattenTree(tree, expanded);

    expect(flat.find((f) => f.node.id === 'root')!.isLast).toBeTruthy();
    expect(flat.find((f) => f.node.id === 'a')!.isLast).toBeFalsy();
    expect(flat.find((f) => f.node.id === 'c')!.isLast).toBeTruthy();
    expect(flat.find((f) => f.node.id === 'b2')!.isLast).toBeTruthy();
  });

  it('sets hasChildren and expanded flags', () => {
    const expanded = new Set(['root']);
    const flat = flattenTree(tree, expanded);

    const rootFlat = flat.find((f) => f.node.id === 'root')!;
    expect(rootFlat.hasChildren).toBeTruthy();
    expect(rootFlat.expanded).toBeTruthy();

    const bFlat = flat.find((f) => f.node.id === 'b')!;
    expect(bFlat.hasChildren).toBeTruthy();
    expect(bFlat.expanded).toBeFalsy();

    const aFlat = flat.find((f) => f.node.id === 'a')!;
    expect(aFlat.hasChildren).toBeFalsy();
    expect(aFlat.expanded).toBeFalsy();
  });

  it('returns empty array for empty tree', () => {
    expect(flattenTree([], new Set())).toEqual([]);
  });
});
