import React, { useState, useMemo, useCallback } from "react";
import { Box, Text, useInput } from "ink";

import { fuzzyMatch } from "./fuzzy-match.js";

export interface FuzzySelectItem {
  label: string;
  value: string;
}

export interface FuzzySelectProps {
  items: FuzzySelectItem[];
  onSelect: (item: FuzzySelectItem) => void;
  onCancel?: () => void;
  placeholder?: string;
  maxVisible?: number;
  isActive?: boolean;
  renderItem?: (
    item: FuzzySelectItem,
    selected: boolean,
    highlighted: string
  ) => React.ReactNode;
}

function highlightLabel(label: string, indices: number[]): React.ReactNode {
  if (indices.length === 0) return label;

  const indexSet = new Set(indices);
  const parts: React.ReactNode[] = [];

  for (let i = 0; i < label.length; i++) {
    if (indexSet.has(i)) {
      parts.push(
        <Text key={i} bold>
          {label[i]}
        </Text>
      );
    } else {
      parts.push(label[i]);
    }
  }

  return <Text>{parts}</Text>;
}

function highlightLabelString(label: string, indices: number[]): string {
  if (indices.length === 0) return label;
  const indexSet = new Set(indices);
  let result = "";
  for (let i = 0; i < label.length; i++) {
    if (indexSet.has(i)) {
      result += `[${label[i]}]`;
    } else {
      result += label[i];
    }
  }
  return result;
}

export function FuzzySelect({
  items,
  onSelect,
  onCancel,
  placeholder = "Type to filter...",
  maxVisible = 10,
  isActive = true,
  renderItem,
}: FuzzySelectProps): React.ReactNode {
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);

  const filtered = useMemo(() => {
    if (query === "") {
      return items.map((item) => ({
        item,
        score: 0,
        indices: [] as number[],
      }));
    }

    return items
      .map((item) => {
        const result = fuzzyMatch(query, item.label);
        return { item, score: result.score, indices: result.indices };
      })
      .filter((r) => {
        const result = fuzzyMatch(query, r.item.label);
        return result.matches;
      })
      .sort((a, b) => b.score - a.score);
  }, [items, query]);

  const clampedIndex = Math.min(selectedIndex, Math.max(0, filtered.length - 1));

  // window calculation
  const windowStart = Math.max(
    0,
    Math.min(clampedIndex - Math.floor(maxVisible / 2), filtered.length - maxVisible)
  );
  const visibleItems = filtered.slice(windowStart, windowStart + maxVisible);

  useInput(
    useCallback(
      (input: string, key: { upArrow?: boolean; downArrow?: boolean; return?: boolean; escape?: boolean; backspace?: boolean; delete?: boolean }) => {
        if (key.escape) {
          onCancel?.();
          return;
        }

        if (key.return) {
          if (filtered.length > 0) {
            const idx = Math.min(clampedIndex, filtered.length - 1);
            onSelect(filtered[idx]!.item);
          }
          return;
        }

        if (key.upArrow) {
          setSelectedIndex((prev) => Math.max(0, prev - 1));
          return;
        }

        if (key.downArrow) {
          setSelectedIndex((prev) => Math.min(filtered.length - 1, prev + 1));
          return;
        }

        if (key.backspace || key.delete) {
          setQuery((prev) => {
            const next = prev.slice(0, -1);
            setSelectedIndex(0);
            return next;
          });
          return;
        }

        if (input && !key.return && !key.escape) {
          setQuery((prev) => {
            const next = prev + input;
            setSelectedIndex(0);
            return next;
          });
        }
      },
      [filtered, clampedIndex, onSelect, onCancel]
    ),
    { isActive }
  );

  return (
    <Box flexDirection="column">
      <Box>
        <Text>

          {"> "}
          {query.length > 0 ? query : <Text dimColor>{placeholder}</Text>}
        </Text>
      </Box>

      {filtered.length === 0 ? (
        <Box>
          <Text dimColor>No matches</Text>
        </Box>
      ) : (
        visibleItems.map((entry, i) => {
          const isSelected = windowStart + i === clampedIndex;
          const { item, indices } = entry;

          if (renderItem) {
            return (
              <Box key={item.value}>
                {renderItem(item, isSelected, highlightLabelString(item.label, indices))}
              </Box>
            );
          }

          return (
            <Box key={item.value}>
              <Text color={isSelected ? "cyan" : undefined} bold={isSelected}>
                {isSelected ? "> " : "  "}
                {query.length > 0
                  ? highlightLabel(item.label, indices)
                  : item.label}
              </Text>
            </Box>
          );
        })
      )}
    </Box>
  );
}
