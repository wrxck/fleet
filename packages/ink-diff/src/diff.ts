export type DiffLine = {
  type: 'add' | 'remove' | 'unchanged';
  content: string;
  oldLineNo?: number;
  newLineNo?: number;
};

/**
 * Compute the Longest Common Subsequence table for two arrays of lines.
 * Returns a 2D array where lcs[i][j] is the LCS length of
 * oldLines[0..i-1] and newLines[0..j-1].
 */
function computeLCS(oldLines: string[], newLines: string[]): number[][] {
  const n = oldLines.length;
  const m = newLines.length;
  const table: number[][] = Array.from({ length: n + 1 }, () =>
    new Array<number>(m + 1).fill(0),
  );

  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      if (oldLines[i - 1] === newLines[j - 1]) {
        table[i][j] = table[i - 1][j - 1] + 1;
      } else {
        table[i][j] = Math.max(table[i - 1][j], table[i][j - 1]);
      }
    }
  }

  return table;
}

/**
 * Produce a line-by-line diff between oldLines and newLines using
 * a basic O(n*m) LCS algorithm.
 */
export function diffLines(oldLines: string[], newLines: string[]): DiffLine[] {
  const table = computeLCS(oldLines, newLines);
  const result: DiffLine[] = [];

  let i = oldLines.length;
  let j = newLines.length;

  // backtrack through the LCS table to produce the diff
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && oldLines[i - 1] === newLines[j - 1]) {
      result.push({
        type: 'unchanged',
        content: oldLines[i - 1],
        oldLineNo: i,
        newLineNo: j,
      });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || table[i][j - 1] >= table[i - 1][j])) {
      result.push({
        type: 'add',
        content: newLines[j - 1],
        newLineNo: j,
      });
      j--;
    } else {
      result.push({
        type: 'remove',
        content: oldLines[i - 1],
        oldLineNo: i,
      });
      i--;
    }
  }

  result.reverse();
  return result;
}

/**
 * Filter diff lines to only show changes and surrounding context lines.
 */
export function applyContext(lines: DiffLine[], context: number): DiffLine[] {
  if (context < 0) return lines;

  // mark which lines should be visible
  const visible = new Array<boolean>(lines.length).fill(false);

  for (let i = 0; i < lines.length; i++) {
    if (lines[i].type !== 'unchanged') {
      const start = Math.max(0, i - context);
      const end = Math.min(lines.length - 1, i + context);
      for (let k = start; k <= end; k++) {
        visible[k] = true;
      }
    }
  }

  return lines.filter((_, i) => visible[i]);
}
