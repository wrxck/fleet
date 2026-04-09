export type InlineNode =
  | { type: 'text'; content: string }
  | { type: 'bold'; content: string }
  | { type: 'italic'; content: string }
  | { type: 'code'; content: string }
  | { type: 'link'; text: string; url: string };

export type BlockNode =
  | { type: 'heading'; level: 1 | 2 | 3; inline: InlineNode[] }
  | { type: 'paragraph'; inline: InlineNode[] }
  | { type: 'code-block'; lang: string; content: string }
  | { type: 'bullet-list-item'; inline: InlineNode[] }
  | { type: 'ordered-list-item'; number: number; inline: InlineNode[] }
  | { type: 'hr' }
  | { type: 'blockquote'; inline: InlineNode[] };

const HR_CHAR = '\u2500';
const QUOTE_CHAR = '\u2502';

export { HR_CHAR, QUOTE_CHAR };

export function parseInline(text: string): InlineNode[] {
  const nodes: InlineNode[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    // `code`
    const codeMatch = remaining.match(/^`([^`]+)`/);
    if (codeMatch) {
      nodes.push({ type: 'code', content: codeMatch[1] });
      remaining = remaining.slice(codeMatch[0].length);
      continue;
    }

    // [text](url)
    const linkMatch = remaining.match(/^\[([^\]]+)\]\(([^)]+)\)/);
    if (linkMatch) {
      nodes.push({ type: 'link', text: linkMatch[1], url: linkMatch[2] });
      remaining = remaining.slice(linkMatch[0].length);
      continue;
    }

    // **bold**
    const boldMatch = remaining.match(/^\*\*(.+?)\*\*/);
    if (boldMatch) {
      nodes.push({ type: 'bold', content: boldMatch[1] });
      remaining = remaining.slice(boldMatch[0].length);
      continue;
    }

    // *italic* or _italic_
    const italicMatch = remaining.match(/^(\*([^*]+?)\*|_([^_]+?)_)/);
    if (italicMatch) {
      const content = italicMatch[2] ?? italicMatch[3];
      nodes.push({ type: 'italic', content });
      remaining = remaining.slice(italicMatch[0].length);
      continue;
    }

    // plain text up to next special char
    const nextSpecial = remaining.slice(1).search(/[`*_\[]/);
    if (nextSpecial === -1) {
      nodes.push({ type: 'text', content: remaining });
      remaining = '';
    } else {
      const end = nextSpecial + 1;
      nodes.push({ type: 'text', content: remaining.slice(0, end) });
      remaining = remaining.slice(end);
    }
  }

  return nodes;
}

export function parseMarkdown(markdown: string): BlockNode[] {
  const lines = markdown.split('\n');
  const blocks: BlockNode[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (line.trimStart().startsWith('```')) {
      const lang = line.trimStart().slice(3).trim();
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trimStart().startsWith('```')) {
        codeLines.push(lines[i]);
        i++;
      }
      if (i < lines.length) i++;
      blocks.push({ type: 'code-block', lang, content: codeLines.join('\n') });
      continue;
    }

    if (line.trim() === '') {
      i++;
      continue;
    }

    if (/^(\s*[-*]){3,}\s*$/.test(line) && !/\w/.test(line)) {
      blocks.push({ type: 'hr' });
      i++;
      continue;
    }

    const headingMatch = line.match(/^(#{1,3})\s+(.+)/);
    if (headingMatch) {
      const level = headingMatch[1].length as 1 | 2 | 3;
      blocks.push({ type: 'heading', level, inline: parseInline(headingMatch[2]) });
      i++;
      continue;
    }

    const bulletMatch = line.match(/^[-*]\s+(.+)/);
    if (bulletMatch) {
      blocks.push({ type: 'bullet-list-item', inline: parseInline(bulletMatch[1]) });
      i++;
      continue;
    }

    const orderedMatch = line.match(/^(\d+)\.\s+(.+)/);
    if (orderedMatch) {
      blocks.push({
        type: 'ordered-list-item',
        number: parseInt(orderedMatch[1], 10),
        inline: parseInline(orderedMatch[2]),
      });
      i++;
      continue;
    }

    const quoteMatch = line.match(/^>\s?(.*)/);
    if (quoteMatch) {
      blocks.push({ type: 'blockquote', inline: parseInline(quoteMatch[1]) });
      i++;
      continue;
    }

    blocks.push({ type: 'paragraph', inline: parseInline(line) });
    i++;
  }

  return blocks;
}
