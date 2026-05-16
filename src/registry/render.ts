import type { RenderModel, TreeNode } from './types';

/** turns a RenderModel into a plain-text block for cli output. */
export function renderToText(model: RenderModel): string {
  switch (model.kind) {
    case 'lines':
      return model.lines.join('\n');
    case 'keyValue': {
      const width = Math.max(0, ...model.pairs.map(([k]) => k.length));
      return model.pairs.map(([k, v]) => `${k.padEnd(width + 2)}${v}`).join('\n');
    }
    case 'table': {
      const all = [model.columns, ...model.rows];
      const widths = model.columns.map((_, i) =>
        Math.max(...all.map(row => (row[i] ?? '').length)),
      );
      const fmt = (row: string[]): string =>
        row
          .slice(0, model.columns.length)
          .map((cell, i) => (i === model.columns.length - 1 ? cell : cell.padEnd(widths[i] + 2)))
          .join('');
      return all.map(fmt).join('\n');
    }
    case 'tree':
      return treeLines(model.root, 0).join('\n');
  }
}

function treeLines(node: TreeNode, depth: number): string[] {
  const out = ['  '.repeat(depth) + node.label];
  for (const child of node.children ?? []) {
    out.push(...treeLines(child, depth + 1));
  }
  return out;
}
