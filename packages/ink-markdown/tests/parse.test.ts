import { describe, it, expect } from 'vitest';

import { parseInline, parseMarkdown } from '../src/parse.js';

describe('parseInline', () => {
  it('parses plain text', () => {
    const result = parseInline('hello world');
    expect(result).toEqual([{ type: 'text', content: 'hello world' }]);
  });

  it('parses bold text', () => {
    const result = parseInline('some **bold** text');
    expect(result).toEqual([
      { type: 'text', content: 'some ' },
      { type: 'bold', content: 'bold' },
      { type: 'text', content: ' text' },
    ]);
  });

  it('parses italic with asterisks', () => {
    const result = parseInline('some *italic* text');
    expect(result).toEqual([
      { type: 'text', content: 'some ' },
      { type: 'italic', content: 'italic' },
      { type: 'text', content: ' text' },
    ]);
  });

  it('parses italic with underscores', () => {
    const result = parseInline('some _italic_ text');
    expect(result).toEqual([
      { type: 'text', content: 'some ' },
      { type: 'italic', content: 'italic' },
      { type: 'text', content: ' text' },
    ]);
  });

  it('parses inline code', () => {
    const result = parseInline('use `npm install` here');
    expect(result).toEqual([
      { type: 'text', content: 'use ' },
      { type: 'code', content: 'npm install' },
      { type: 'text', content: ' here' },
    ]);
  });

  it('parses links', () => {
    const result = parseInline('visit [example](https://example.com) now');
    expect(result).toEqual([
      { type: 'text', content: 'visit ' },
      { type: 'link', text: 'example', url: 'https://example.com' },
      { type: 'text', content: ' now' },
    ]);
  });
});

describe('parseMarkdown', () => {
  it('identifies h1 headings', () => {
    const result = parseMarkdown('# Title');
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('heading');
    if (result[0].type === 'heading') {
      expect(result[0].level).toBe(1);
    }
  });

  it('identifies h2 headings', () => {
    const result = parseMarkdown('## Subtitle');
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('heading');
    if (result[0].type === 'heading') {
      expect(result[0].level).toBe(2);
    }
  });

  it('identifies h3 headings', () => {
    const result = parseMarkdown('### Section');
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('heading');
    if (result[0].type === 'heading') {
      expect(result[0].level).toBe(3);
    }
  });

  it('identifies bullet list items', () => {
    const result = parseMarkdown('- item one\n- item two');
    expect(result).toHaveLength(2);
    expect(result[0].type).toBe('bullet-list-item');
    expect(result[1].type).toBe('bullet-list-item');
  });

  it('identifies ordered list items', () => {
    const result = parseMarkdown('1. first\n2. second');
    expect(result).toHaveLength(2);
    expect(result[0].type).toBe('ordered-list-item');
    if (result[0].type === 'ordered-list-item') {
      expect(result[0].number).toBe(1);
    }
  });

  it('identifies code blocks', () => {
    const result = parseMarkdown('```js\nconst x = 1;\n```');
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('code-block');
    if (result[0].type === 'code-block') {
      expect(result[0].lang).toBe('js');
      expect(result[0].content).toBe('const x = 1;');
    }
  });

  it('identifies horizontal rules', () => {
    const result = parseMarkdown('---');
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('hr');
  });

  it('identifies blockquotes', () => {
    const result = parseMarkdown('> some quote');
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('blockquote');
  });

  it('skips blank lines', () => {
    const result = parseMarkdown('hello\n\nworld');
    expect(result).toHaveLength(2);
    expect(result[0].type).toBe('paragraph');
    expect(result[1].type).toBe('paragraph');
  });
});
