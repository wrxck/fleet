import { describe, it, expect } from 'vitest';

import { diffLines } from '../src/diff.js';

describe('diffLines', () => {
  it('detects additions', () => {
    const result = diffLines(['a'], ['a', 'b']);
    expect(result).toEqual([
      { type: 'unchanged', content: 'a', oldLineNo: 1, newLineNo: 1 },
      { type: 'add', content: 'b', newLineNo: 2 },
    ]);
  });

  it('detects removals', () => {
    const result = diffLines(['a', 'b'], ['a']);
    expect(result).toEqual([
      { type: 'unchanged', content: 'a', oldLineNo: 1, newLineNo: 1 },
      { type: 'remove', content: 'b', oldLineNo: 2 },
    ]);
  });

  it('handles unchanged text', () => {
    const result = diffLines(['a', 'b', 'c'], ['a', 'b', 'c']);
    expect(result).toEqual([
      { type: 'unchanged', content: 'a', oldLineNo: 1, newLineNo: 1 },
      { type: 'unchanged', content: 'b', oldLineNo: 2, newLineNo: 2 },
      { type: 'unchanged', content: 'c', oldLineNo: 3, newLineNo: 3 },
    ]);
  });

  it('handles mixed changes', () => {
    const result = diffLines(['a', 'b', 'c'], ['a', 'x', 'c']);
    // b removed, x added, a and c unchanged
    const types = result.map((r) => r.type);
    expect(types).toContain('remove');
    expect(types).toContain('add');
    expect(types.filter((t) => t === 'unchanged')).toHaveLength(2);
    expect(result.find((r) => r.type === 'remove')?.content).toBe('b');
    expect(result.find((r) => r.type === 'add')?.content).toBe('x');
  });

  it('handles empty old text', () => {
    const result = diffLines([], ['a', 'b']);
    expect(result).toEqual([
      { type: 'add', content: 'a', newLineNo: 1 },
      { type: 'add', content: 'b', newLineNo: 2 },
    ]);
  });

  it('handles empty new text', () => {
    const result = diffLines(['a', 'b'], []);
    expect(result).toEqual([
      { type: 'remove', content: 'a', oldLineNo: 1 },
      { type: 'remove', content: 'b', oldLineNo: 2 },
    ]);
  });

  it('returns all unchanged for identical strings', () => {
    const lines = ['alpha', 'beta', 'gamma'];
    const result = diffLines(lines, lines);
    expect(result.every((r) => r.type === 'unchanged')).toBe(true);
    expect(result).toHaveLength(3);
  });
});
