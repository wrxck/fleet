import fs from 'node:fs';
import path from 'node:path';

import React, { useState, useMemo, useCallback } from 'react';
import { Box, Text, useInput } from 'ink';

export interface FilePickerProps {
  initialPath?: string;
  extensions?: string[];
  showHidden?: boolean;
  maxVisible?: number;
  onSelect: (path: string) => void;
  onCancel?: () => void;
}

interface DirEntry {
  name: string;
  isDirectory: boolean;
  size: number;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}K`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)}M`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)}G`;
}

function readDirectory(
  dirPath: string,
  extensions: string[] | undefined,
  showHidden: boolean,
): DirEntry[] {
  let names: string[];
  try {
    names = fs.readdirSync(dirPath);
  } catch {
    return [];
  }

  const entries: DirEntry[] = [];

  for (const name of names) {
    if (!showHidden && name.startsWith('.')) continue;

    const fullPath = path.join(dirPath, name);
    let stat: fs.Stats;
    try {
      stat = fs.statSync(fullPath);
    } catch {
      continue;
    }

    const isDir = stat.isDirectory();

    if (!isDir && extensions && extensions.length > 0) {
      const ext = path.extname(name);
      if (!extensions.includes(ext)) continue;
    }

    entries.push({ name, isDirectory: isDir, size: stat.size });
  }

  const dirs = entries.filter((e) => e.isDirectory).sort((a, b) => a.name.localeCompare(b.name));
  const files = entries.filter((e) => !e.isDirectory).sort((a, b) => a.name.localeCompare(b.name));

  return [...dirs, ...files];
}

const DIR_PREFIX = '> ';
const FILE_PREFIX = '- ';

export function FilePicker({
  initialPath,
  extensions,
  showHidden = false,
  maxVisible = 15,
  onSelect,
  onCancel,
}: FilePickerProps): React.JSX.Element {
  const [currentPath, setCurrentPath] = useState(() =>
    path.resolve(initialPath ?? process.cwd()),
  );
  const [selectedIndex, setSelectedIndex] = useState(0);

  const entries = useMemo(
    () => readDirectory(currentPath, extensions, showHidden),
    [currentPath, extensions, showHidden],
  );

  const openDirectory = useCallback(
    (dirPath: string) => {
      setCurrentPath(dirPath);
      setSelectedIndex(0);
    },
    [],
  );

  useInput((input, key) => {
    if (key.escape) {
      onCancel?.();
      return;
    }

    if (key.backspace || key.delete) {
      const parent = path.dirname(currentPath);
      if (parent !== currentPath) {
        openDirectory(parent);
      }
      return;
    }

    if (key.return) {
      if (entries.length === 0) return;
      const entry = entries[selectedIndex];
      if (!entry) return;
      const fullPath = path.join(currentPath, entry.name);
      if (entry.isDirectory) {
        openDirectory(fullPath);
      } else {
        onSelect(fullPath);
      }
      return;
    }

    if (key.downArrow || input === 'j') {
      setSelectedIndex((prev) => Math.min(prev + 1, entries.length - 1));
      return;
    }

    if (key.upArrow || input === 'k') {
      setSelectedIndex((prev) => Math.max(prev - 1, 0));
      return;
    }
  });

  const displayCount = Math.min(maxVisible, entries.length);
  let scrollOffset = 0;

  if (selectedIndex >= scrollOffset + displayCount) {
    scrollOffset = selectedIndex - displayCount + 1;
  }
  if (selectedIndex < scrollOffset) {
    scrollOffset = selectedIndex;
  }
  scrollOffset = Math.max(0, Math.min(scrollOffset, entries.length - displayCount));

  const visibleEntries = entries.slice(scrollOffset, scrollOffset + displayCount);
  const hasAbove = scrollOffset > 0;
  const hasBelow = scrollOffset + displayCount < entries.length;

  return (
    <Box flexDirection="column">
      <Text bold color="blue">
        {currentPath}
      </Text>

      {hasAbove && <Text dimColor>{'\u2191'} more above</Text>}

      {entries.length === 0 ? (
        <Text dimColor>Empty directory</Text>
      ) : (
        visibleEntries.map((entry, i) => {
          const realIndex = scrollOffset + i;
          const isSelected = realIndex === selectedIndex;
          const prefix = entry.isDirectory ? DIR_PREFIX : FILE_PREFIX;

          return (
            <Box key={entry.name}>
              <Text bold={isSelected} color={isSelected ? 'cyan' : undefined}>
                {prefix}
                {entry.name}
              </Text>
              {!entry.isDirectory && (
                <Text dimColor> {formatSize(entry.size)}</Text>
              )}
            </Box>
          );
        })
      )}

      {hasBelow && <Text dimColor>{'\u2193'} more below</Text>}
    </Box>
  );
}
