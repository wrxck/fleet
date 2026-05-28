import { describe, it, expect } from 'vitest';

import { renderToText } from './render';

describe('renderToText', () => {
  it('renders lines', () => {
    expect(renderToText({ kind: 'lines', lines: ['a', 'b'] })).toBe('a\nb');
  });

  it('renders key-value pairs aligned', () => {
    const out = renderToText({ kind: 'keyValue', pairs: [['App', 'web'], ['Health', 'ok']] });
    expect(out).toBe('App     web\nHealth  ok');
  });

  it('renders a table with padded columns', () => {
    const out = renderToText({
      kind: 'table',
      columns: ['NAME', 'STATE'],
      rows: [['web', 'up'], ['db', 'down']],
    });
    expect(out).toBe('NAME  STATE\nweb   up\ndb    down');
  });

  it('renders a tree with indentation', () => {
    const out = renderToText({
      kind: 'tree',
      root: { label: 'root', children: [{ label: 'child' }] },
    });
    expect(out).toBe('root\n  child');
  });

  it('renders empty lines as an empty string', () => {
    expect(renderToText({ kind: 'lines', lines: [] })).toBe('');
  });

  it('renders a header-only table', () => {
    expect(renderToText({ kind: 'table', columns: ['NAME'], rows: [] })).toBe('NAME');
  });

  it('renders a deep tree', () => {
    const out = renderToText({
      kind: 'tree',
      root: { label: 'a', children: [{ label: 'b', children: [{ label: 'c' }] }] },
    });
    expect(out).toBe('a\n  b\n    c');
  });
});
