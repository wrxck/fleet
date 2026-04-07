# @wrxck/ink-markdown

Render markdown in the terminal for Ink 5.

Handles headings, bold, italic, code blocks, inline code, lists (bullet and ordered), links, blockquotes, and horizontal rules. No external markdown parser dependency.

## Install

```
npm install @wrxck/ink-markdown
```

## Usage

```tsx
import { Markdown } from '@wrxck/ink-markdown';

function App() {
  const text = `
# Hello World

This is **bold** and *italic* text.

- bullet one
- bullet two

> a blockquote
`;

  return <Markdown maxWidth={80}>{text}</Markdown>;
}
```

## Props

| Prop       | Type     | Description              |
| ---------- | -------- | ------------------------ |
| `children` | `string` | Markdown text to render  |
| `maxWidth` | `number` | Optional wrap width      |

## Supported markdown

- `# Heading 1` - bold + uppercase
- `## Heading 2` - bold
- `### Heading 3` - bold + dim
- `**bold**` - bold text
- `*italic*` / `_italic_` - dim text
- `` `inline code` `` - inverse/highlighted
- Code blocks (triple backtick) - indented, dim
- `- item` / `* item` - bullet lists
- `1. item` - numbered lists
- `---` / `***` - horizontal rule
- `[text](url)` - underlined text with dimmed url
- `> blockquote` - indented with bar prefix

## Licence

MIT
