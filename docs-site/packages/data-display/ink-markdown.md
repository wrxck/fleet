# ink-markdown

Render markdown in the terminal for Ink 5 -- headings, bold, italic, code blocks, lists, links, blockquotes, and horizontal rules.

## Installation

```bash
npm install @matthesketh/ink-markdown
```

Peer dependencies: `ink` (>=5.0.0), `react` (>=18.0.0).

## Usage

```tsx
import React from 'react';
import { render } from 'ink';
import { Markdown } from '@matthesketh/ink-markdown';

const content = `
# Welcome

This is **bold** and *italic* text with \`inline code\`.

## Features

- Headings (h1-h3)
- **Bold**, *italic*, \`code\`
- [Links](https://example.com)
- Bullet and ordered lists

> A blockquote for emphasis.

\`\`\`js
const greeting = 'Hello, terminal!';
console.log(greeting);
\`\`\`

---

1. First item
2. Second item
`;

function App() {
  return <Markdown>{content}</Markdown>;
}

render(<App />);
```

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `children` | `string` | **(required)** | The markdown string to render. |
| `maxWidth` | `number` | `undefined` | Constrain the output to a fixed column width. |

## Supported Markdown Elements

| Element | Syntax | Rendering |
|---------|--------|-----------|
| Heading 1 | `# Title` | Bold, uppercase text. |
| Heading 2 | `## Title` | Bold text. |
| Heading 3 | `### Title` | Bold, dimmed text. |
| Bold | `**text**` | Bold. |
| Italic | `*text*` or `_text_` | Dimmed colour. |
| Inline code | `` `code` `` | Inverse (highlighted) with padding. |
| Link | `[text](url)` | Underlined text followed by dimmed URL. |
| Code block | ` ```lang ... ``` ` | Indented, dimmed text. Language tag is parsed but not used for syntax highlighting. |
| Bullet list | `- item` or `* item` | Bullet character prefix. |
| Ordered list | `1. item` | Numbered prefix. |
| Blockquote | `> text` | Vertical bar prefix, dimmed. |
| Horizontal rule | `---` or `***` | 40-character horizontal line, dimmed. |

## Examples

### Constrained width

```tsx
<Markdown maxWidth={60}>{readmeText}</Markdown>
```

### Using the parser directly

The `parseMarkdown` and `parseInline` functions are exported for custom rendering:

```ts
import { parseMarkdown, parseInline } from '@matthesketh/ink-markdown';
import type { BlockNode, InlineNode } from '@matthesketh/ink-markdown';

const blocks: BlockNode[] = parseMarkdown('# Hello\n\nSome **bold** text.');
const inline: InlineNode[] = parseInline('**bold** and *italic*');
```

#### BlockNode types

- `{ type: 'heading'; level: 1 | 2 | 3; inline: InlineNode[] }`
- `{ type: 'paragraph'; inline: InlineNode[] }`
- `{ type: 'code-block'; lang: string; content: string }`
- `{ type: 'bullet-list-item'; inline: InlineNode[] }`
- `{ type: 'ordered-list-item'; number: number; inline: InlineNode[] }`
- `{ type: 'hr' }`
- `{ type: 'blockquote'; inline: InlineNode[] }`

#### InlineNode types

- `{ type: 'text'; content: string }`
- `{ type: 'bold'; content: string }`
- `{ type: 'italic'; content: string }`
- `{ type: 'code'; content: string }`
- `{ type: 'link'; text: string; url: string }`

## Notes

- The parser is intentionally simple and does not cover the full CommonMark spec. It handles the most common patterns for terminal display.
- Nested formatting (e.g. bold inside italic) is not supported -- the first match wins.
- Code blocks preserve their content verbatim. The language tag is parsed but not used for syntax highlighting.
- Empty lines in the input are skipped (they do not produce blank paragraph nodes).
