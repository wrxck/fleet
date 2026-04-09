import React from 'react';
import { Text, Box } from 'ink';

import { parseMarkdown, HR_CHAR, QUOTE_CHAR, type InlineNode, type BlockNode } from './parse.js';

export interface MarkdownProps {
  children: string;
  maxWidth?: number;
}

function renderInline(nodes: InlineNode[], keyPrefix: string): React.ReactNode[] {
  return nodes.map((node, i) => {
    const key = `${keyPrefix}-${i}`;
    switch (node.type) {
      case 'text':
        return <Text key={key}>{node.content}</Text>;
      case 'bold':
        return <Text key={key} bold>{node.content}</Text>;
      case 'italic':
        return <Text key={key} dimColor>{node.content}</Text>;
      case 'code':
        return <Text key={key} inverse>{` ${node.content} `}</Text>;
      case 'link':
        return (
          <Text key={key}>
            <Text underline>{node.text}</Text>
            <Text dimColor>{` (${node.url})`}</Text>
          </Text>
        );
    }
  });
}

function renderBlock(block: BlockNode, index: number): React.ReactNode {
  const key = `block-${index}`;

  switch (block.type) {
    case 'heading': {
      const inlineContent = renderInline(block.inline, key);
      if (block.level === 1) {
        return (
          <Box key={key} marginBottom={0}>
            <Text bold>
              {inlineContent.map((node, i) => {
                if (React.isValidElement(node) && typeof node.props.children === 'string') {
                  return <Text key={i} bold>{(node.props.children as string).toUpperCase()}</Text>;
                }
                return node;
              })}
            </Text>
          </Box>
        );
      }
      if (block.level === 2) {
        return (
          <Box key={key} marginBottom={0}>
            <Text bold>{inlineContent}</Text>
          </Box>
        );
      }
      return (
        <Box key={key} marginBottom={0}>
          <Text bold dimColor>{inlineContent}</Text>
        </Box>
      );
    }

    case 'paragraph':
      return (
        <Box key={key}>
          <Text>{renderInline(block.inline, key)}</Text>
        </Box>
      );

    case 'code-block':
      return (
        <Box key={key} paddingLeft={2}>
          <Text dimColor>{block.content}</Text>
        </Box>
      );

    case 'bullet-list-item':
      return (
        <Box key={key} paddingLeft={1}>
          <Text>{'\u2022 '}</Text>
          <Text>{renderInline(block.inline, key)}</Text>
        </Box>
      );

    case 'ordered-list-item':
      return (
        <Box key={key} paddingLeft={1}>
          <Text>{`${block.number}. `}</Text>
          <Text>{renderInline(block.inline, key)}</Text>
        </Box>
      );

    case 'hr':
      return (
        <Box key={key}>
          <Text dimColor>{HR_CHAR.repeat(40)}</Text>
        </Box>
      );

    case 'blockquote':
      return (
        <Box key={key} paddingLeft={1}>
          <Text dimColor>{QUOTE_CHAR} </Text>
          <Text>{renderInline(block.inline, key)}</Text>
        </Box>
      );
  }
}

export function Markdown({ children, maxWidth }: MarkdownProps): React.ReactElement {
  const blocks = parseMarkdown(children);
  const content = blocks.map((block, i) => renderBlock(block, i));

  if (maxWidth !== undefined) {
    return <Box flexDirection="column" width={maxWidth}>{content}</Box>;
  }

  return <Box flexDirection="column">{content}</Box>;
}
