# TUI Stability Overhaul — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix all TUI bugs (flickering, double-scroll, character duplication) by rebuilding input handling, state management, and scrolling — and extract reusable Ink packages along the way.

**Architecture:** Single input dispatcher at the root eliminates competing `useInput` handlers. Selection state moves into the reducer to survive data refreshes. A new `ScrollableList` component handles windowed rendering. Three packages extracted: `@wrxck/ink-input-dispatcher`, `@wrxck/ink-scrollable-list`, `@wrxck/ink-viewport`.

**Tech Stack:** React 18, Ink 5, TypeScript, Vitest, ink-testing-library

**Spec:** `docs/superpowers/specs/2026-04-06-tui-stability-overhaul-design.md`

---

## Phase 1: New Ink Packages

These packages solve real gaps in the Ink ecosystem. They'll be developed as standalone packages under `packages/`, published to npm under `@wrxck/`, and consumed by Fleet's TUI.

### Ink Ecosystem Gaps (research findings)

| Need | Existing | Problem |
|------|----------|---------|
| Scrollable list with windowing | `ink-scroll-list` v0.4 | Requires Ink 6 / React 19 |
| Input dispatcher / routing | Nothing | Every Ink app reinvents this |
| Terminal size hook | `ink-use-stdout-dimensions` v1 | Last updated 2020, Ink 2 era |
| Viewport-aware layout | Nothing | Everyone hardcodes row counts |
| Select input with scroll | `ink-select-input` v6 | No windowing, breaks with 50+ items |

---

### Task 1: Monorepo Setup for Packages

**Files:**
- Create: `packages/README.md`
- Modify: `package.json` (add workspaces)
- Modify: `tsconfig.json` (add package paths)

- [ ] **Step 1: Add workspaces config to root package.json**

```json
{
  "workspaces": ["packages/*"]
}
```

- [ ] **Step 2: Create packages directory**

```bash
mkdir -p packages
```

- [ ] **Step 3: Create packages README**

```markdown
# @wrxck/ink-* packages

Reusable Ink 5 components for modern terminal UIs.

- `@wrxck/ink-viewport` — Terminal size hook and viewport-aware layout
- `@wrxck/ink-scrollable-list` — Windowed scrollable list with follow-cursor
- `@wrxck/ink-input-dispatcher` — Single-point input routing for Ink apps
```

- [ ] **Step 4: Commit**

```bash
git add packages/README.md package.json
git commit -m "chore: add workspaces config for ink packages"
```

---

### Task 2: `@wrxck/ink-viewport` Package

A `useTerminalSize()` hook that returns `{ rows, columns }` and re-renders on resize. Also exports a `<Viewport>` component that injects available height into children via context.

**Files:**
- Create: `packages/ink-viewport/package.json`
- Create: `packages/ink-viewport/tsconfig.json`
- Create: `packages/ink-viewport/src/index.ts`
- Create: `packages/ink-viewport/src/use-terminal-size.ts`
- Create: `packages/ink-viewport/src/viewport.tsx`
- Create: `packages/ink-viewport/src/context.ts`
- Create: `packages/ink-viewport/tests/use-terminal-size.test.ts`
- Create: `packages/ink-viewport/tests/viewport.test.tsx`
- Create: `packages/ink-viewport/README.md`

- [ ] **Step 1: Scaffold package.json**

```json
{
  "name": "@wrxck/ink-viewport",
  "version": "0.1.0",
  "description": "Terminal size hook and viewport-aware layout for Ink 5",
  "type": "module",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "files": ["dist"],
  "scripts": {
    "build": "tsc",
    "test": "vitest run",
    "prepublishOnly": "npm run build"
  },
  "peerDependencies": {
    "ink": ">=5.0.0",
    "react": ">=18.0.0"
  },
  "devDependencies": {
    "ink": "^5.2.1",
    "react": "^18.3.1",
    "ink-testing-library": "^4.0.0",
    "vitest": "^3.1.1",
    "typescript": "^5.8.3"
  },
  "keywords": ["ink", "ink-component", "terminal", "viewport", "tui", "cli"],
  "license": "MIT",
  "repository": {
    "type": "git",
    "url": "https://github.com/wrxck/fleet.git",
    "directory": "packages/ink-viewport"
  }
}
```

- [ ] **Step 2: Create tsconfig.json**

```json
{
  "extends": "../../tsconfig.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src",
    "declaration": true,
    "jsx": "react-jsx"
  },
  "include": ["src"]
}
```

- [ ] **Step 3: Write failing test for useTerminalSize**

```typescript
// packages/ink-viewport/tests/use-terminal-size.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from 'ink-testing-library'; // We'll need to check if this exists
// NOTE: ink-testing-library doesn't export renderHook. We test via component rendering.
// We'll test the hook through a test component instead.

import React from 'react';
import { render } from 'ink-testing-library';
import { Text } from 'ink';
import { useTerminalSize } from '../src/use-terminal-size.js';

function SizeDisplay(): React.JSX.Element {
  const { rows, columns } = useTerminalSize();
  return <Text>{`${columns}x${rows}`}</Text>;
}

describe('useTerminalSize', () => {
  const originalColumns = process.stdout.columns;
  const originalRows = process.stdout.rows;

  beforeEach(() => {
    Object.defineProperty(process.stdout, 'columns', { value: 80, writable: true, configurable: true });
    Object.defineProperty(process.stdout, 'rows', { value: 24, writable: true, configurable: true });
  });

  afterEach(() => {
    Object.defineProperty(process.stdout, 'columns', { value: originalColumns, writable: true, configurable: true });
    Object.defineProperty(process.stdout, 'rows', { value: originalRows, writable: true, configurable: true });
  });

  it('returns current terminal dimensions', () => {
    const { lastFrame } = render(<SizeDisplay />);
    expect(lastFrame()).toContain('80x24');
  });
});
```

- [ ] **Step 4: Run test, verify it fails**

```bash
cd packages/ink-viewport && npx vitest run tests/use-terminal-size.test.ts
```

Expected: FAIL — module not found

- [ ] **Step 5: Implement useTerminalSize**

```typescript
// packages/ink-viewport/src/use-terminal-size.ts
import { useState, useEffect } from 'react';

export interface TerminalSize {
  rows: number;
  columns: number;
}

export function useTerminalSize(): TerminalSize {
  const [size, setSize] = useState<TerminalSize>({
    rows: process.stdout.rows || 24,
    columns: process.stdout.columns || 80,
  });

  useEffect(() => {
    function onResize() {
      setSize({
        rows: process.stdout.rows || 24,
        columns: process.stdout.columns || 80,
      });
    }

    process.stdout.on('resize', onResize);
    return () => {
      process.stdout.off('resize', onResize);
    };
  }, []);

  return size;
}
```

- [ ] **Step 6: Run test, verify it passes**

```bash
cd packages/ink-viewport && npx vitest run tests/use-terminal-size.test.ts
```

Expected: PASS

- [ ] **Step 7: Write failing test for Viewport component**

```typescript
// packages/ink-viewport/tests/viewport.test.tsx
import React from 'react';
import { render } from 'ink-testing-library';
import { Text } from 'ink';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Viewport, useAvailableHeight } from '../src/viewport.js';

function HeightDisplay(): React.JSX.Element {
  const height = useAvailableHeight();
  return <Text>height:{height}</Text>;
}

describe('Viewport', () => {
  beforeEach(() => {
    Object.defineProperty(process.stdout, 'rows', { value: 40, writable: true, configurable: true });
  });

  it('provides available height minus chrome', () => {
    const { lastFrame } = render(
      <Viewport chrome={6}>
        <HeightDisplay />
      </Viewport>
    );
    expect(lastFrame()).toContain('height:34');
  });
});
```

- [ ] **Step 8: Implement Viewport and context**

```typescript
// packages/ink-viewport/src/context.ts
import { createContext, useContext } from 'react';

export const ViewportContext = createContext<number>(20);

export function useAvailableHeight(): number {
  return useContext(ViewportContext);
}
```

```typescript
// packages/ink-viewport/src/viewport.tsx
import React from 'react';
import { Box } from 'ink';
import { useTerminalSize } from './use-terminal-size.js';
import { ViewportContext } from './context.js';

interface ViewportProps {
  chrome?: number; // rows reserved for header/footer/borders
  children: React.ReactNode;
}

export function Viewport({ chrome = 0, children }: ViewportProps): React.JSX.Element {
  const { rows } = useTerminalSize();
  const available = Math.max(1, rows - chrome);

  return (
    <ViewportContext.Provider value={available}>
      <Box flexDirection="column" height={rows}>
        {children}
      </Box>
    </ViewportContext.Provider>
  );
}
```

- [ ] **Step 9: Create index.ts barrel export**

```typescript
// packages/ink-viewport/src/index.ts
export { useTerminalSize, type TerminalSize } from './use-terminal-size.js';
export { Viewport } from './viewport.js';
export { useAvailableHeight } from './context.js';
```

- [ ] **Step 10: Run all tests, verify they pass**

```bash
cd packages/ink-viewport && npx vitest run
```

- [ ] **Step 11: Write README**

```markdown
# @wrxck/ink-viewport

Terminal size hook and viewport-aware layout for Ink 5 apps.

## Install

```bash
npm install @wrxck/ink-viewport
```

## Usage

### useTerminalSize()

```tsx
import { useTerminalSize } from '@wrxck/ink-viewport';

function MyComponent() {
  const { rows, columns } = useTerminalSize();
  return <Text>{columns}x{rows}</Text>;
}
```

### Viewport + useAvailableHeight()

```tsx
import { Viewport, useAvailableHeight } from '@wrxck/ink-viewport';

function App() {
  return (
    <Viewport chrome={4}> {/* 4 rows for header + footer */}
      <ScrollableContent />
    </Viewport>
  );
}

function ScrollableContent() {
  const height = useAvailableHeight(); // terminal rows minus 4
  return <Box height={height}>...</Box>;
}
```

## Requirements

- Ink >= 5.0.0
- React >= 18.0.0
```

- [ ] **Step 12: Commit**

```bash
git add packages/ink-viewport/
git commit -m "feat(ink-viewport): terminal size hook and viewport-aware layout"
```

---

### Task 3: `@wrxck/ink-scrollable-list` Package

A windowed list component that renders only visible items, follows the cursor, and shows scroll indicators.

**Files:**
- Create: `packages/ink-scrollable-list/package.json`
- Create: `packages/ink-scrollable-list/tsconfig.json`
- Create: `packages/ink-scrollable-list/src/index.ts`
- Create: `packages/ink-scrollable-list/src/scrollable-list.tsx`
- Create: `packages/ink-scrollable-list/tests/scrollable-list.test.tsx`
- Create: `packages/ink-scrollable-list/README.md`

- [ ] **Step 1: Scaffold package.json**

```json
{
  "name": "@wrxck/ink-scrollable-list",
  "version": "0.1.0",
  "description": "Windowed scrollable list component for Ink 5 with follow-cursor scrolling",
  "type": "module",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "files": ["dist"],
  "scripts": {
    "build": "tsc",
    "test": "vitest run",
    "prepublishOnly": "npm run build"
  },
  "peerDependencies": {
    "ink": ">=5.0.0",
    "react": ">=18.0.0"
  },
  "devDependencies": {
    "ink": "^5.2.1",
    "react": "^18.3.1",
    "ink-testing-library": "^4.0.0",
    "vitest": "^3.1.1",
    "typescript": "^5.8.3"
  },
  "keywords": ["ink", "ink-component", "scrollable", "list", "tui", "cli", "windowed"],
  "license": "MIT",
  "repository": {
    "type": "git",
    "url": "https://github.com/wrxck/fleet.git",
    "directory": "packages/ink-scrollable-list"
  }
}
```

- [ ] **Step 2: Create tsconfig.json**

```json
{
  "extends": "../../tsconfig.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src",
    "declaration": true,
    "jsx": "react-jsx"
  },
  "include": ["src"]
}
```

- [ ] **Step 3: Write failing tests**

```tsx
// packages/ink-scrollable-list/tests/scrollable-list.test.tsx
import React from 'react';
import { render } from 'ink-testing-library';
import { Text } from 'ink';
import { describe, it, expect } from 'vitest';
import { ScrollableList } from '../src/scrollable-list.js';

const items = Array.from({ length: 20 }, (_, i) => ({ id: String(i), label: `Item ${i}` }));

describe('ScrollableList', () => {
  it('renders only maxVisible items', () => {
    const { lastFrame } = render(
      <ScrollableList
        items={items}
        selectedIndex={0}
        maxVisible={5}
        renderItem={(item, selected) => (
          <Text>{selected ? '> ' : '  '}{item.label}</Text>
        )}
      />
    );
    const frame = lastFrame()!;
    expect(frame).toContain('Item 0');
    expect(frame).toContain('Item 4');
    expect(frame).not.toContain('Item 5');
  });

  it('follows cursor when scrolling down', () => {
    const { lastFrame } = render(
      <ScrollableList
        items={items}
        selectedIndex={7}
        maxVisible={5}
        renderItem={(item, selected) => (
          <Text>{selected ? '> ' : '  '}{item.label}</Text>
        )}
      />
    );
    const frame = lastFrame()!;
    expect(frame).toContain('Item 7');
    expect(frame).not.toContain('Item 0');
  });

  it('shows scroll indicators when items above', () => {
    const { lastFrame } = render(
      <ScrollableList
        items={items}
        selectedIndex={10}
        maxVisible={5}
        renderItem={(item, selected) => (
          <Text>{selected ? '> ' : '  '}{item.label}</Text>
        )}
      />
    );
    const frame = lastFrame()!;
    // Should indicate there are items above
    expect(frame).toMatch(/\u2191|above|more/i);
  });

  it('shows scroll indicators when items below', () => {
    const { lastFrame } = render(
      <ScrollableList
        items={items}
        selectedIndex={0}
        maxVisible={5}
        renderItem={(item, selected) => (
          <Text>{selected ? '> ' : '  '}{item.label}</Text>
        )}
      />
    );
    const frame = lastFrame()!;
    expect(frame).toMatch(/\u2193|below|more/i);
  });

  it('renders empty state when no items', () => {
    const { lastFrame } = render(
      <ScrollableList
        items={[]}
        selectedIndex={0}
        maxVisible={5}
        renderItem={(item, selected) => <Text>{item.label}</Text>}
        emptyText="Nothing here"
      />
    );
    expect(lastFrame()).toContain('Nothing here');
  });

  it('clamps scroll offset when selectedIndex is near end', () => {
    const { lastFrame } = render(
      <ScrollableList
        items={items}
        selectedIndex={19}
        maxVisible={5}
        renderItem={(item, selected) => (
          <Text>{selected ? '> ' : '  '}{item.label}</Text>
        )}
      />
    );
    const frame = lastFrame()!;
    expect(frame).toContain('Item 19');
    expect(frame).toContain('Item 15');
  });
});
```

- [ ] **Step 4: Run tests, verify they fail**

```bash
cd packages/ink-scrollable-list && npx vitest run
```

Expected: FAIL — module not found

- [ ] **Step 5: Implement ScrollableList**

```tsx
// packages/ink-scrollable-list/src/scrollable-list.tsx
import React, { useMemo } from 'react';
import { Box, Text } from 'ink';

export interface ScrollableListProps<T> {
  items: T[];
  selectedIndex: number;
  maxVisible: number;
  renderItem: (item: T, selected: boolean, index: number) => React.ReactNode;
  emptyText?: string;
}

export function ScrollableList<T>({
  items,
  selectedIndex,
  maxVisible,
  renderItem,
  emptyText = 'No items',
}: ScrollableListProps<T>): React.JSX.Element {
  const { visibleItems, scrollOffset, hasAbove, hasBelow } = useMemo(() => {
    if (items.length === 0) {
      return { visibleItems: [] as T[], scrollOffset: 0, hasAbove: false, hasBelow: false };
    }

    const clampedIndex = Math.min(selectedIndex, items.length - 1);
    // Reserve 1 row each for indicators when needed
    const displayRows = Math.min(maxVisible, items.length);

    let offset = 0;

    // Follow cursor: ensure selectedIndex is visible
    if (clampedIndex >= offset + displayRows) {
      offset = clampedIndex - displayRows + 1;
    }
    if (clampedIndex < offset) {
      offset = clampedIndex;
    }

    // Clamp offset
    offset = Math.max(0, Math.min(offset, items.length - displayRows));

    return {
      visibleItems: items.slice(offset, offset + displayRows),
      scrollOffset: offset,
      hasAbove: offset > 0,
      hasBelow: offset + displayRows < items.length,
    };
  }, [items, selectedIndex, maxVisible]);

  if (items.length === 0) {
    return <Text dimColor>{emptyText}</Text>;
  }

  return (
    <Box flexDirection="column">
      {hasAbove && (
        <Text dimColor>  {'\u2191'} {scrollOffset} more above</Text>
      )}
      {visibleItems.map((item, i) => {
        const actualIndex = scrollOffset + i;
        return (
          <Box key={actualIndex}>
            {renderItem(item, actualIndex === selectedIndex, actualIndex)}
          </Box>
        );
      })}
      {hasBelow && (
        <Text dimColor>  {'\u2193'} {items.length - scrollOffset - visibleItems.length} more below</Text>
      )}
    </Box>
  );
}
```

- [ ] **Step 6: Create index.ts**

```typescript
// packages/ink-scrollable-list/src/index.ts
export { ScrollableList, type ScrollableListProps } from './scrollable-list.js';
```

- [ ] **Step 7: Run tests, verify they pass**

```bash
cd packages/ink-scrollable-list && npx vitest run
```

- [ ] **Step 8: Write README**

```markdown
# @wrxck/ink-scrollable-list

Windowed scrollable list component for Ink 5. Renders only visible items, follows the cursor, shows scroll indicators.

## Install

```bash
npm install @wrxck/ink-scrollable-list
```

## Usage

```tsx
import { ScrollableList } from '@wrxck/ink-scrollable-list';

function MyList() {
  const [selectedIndex, setSelectedIndex] = useState(0);

  useInput((input, key) => {
    if (key.downArrow) setSelectedIndex(i => Math.min(i + 1, items.length - 1));
    if (key.upArrow) setSelectedIndex(i => Math.max(i - 1, 0));
  });

  return (
    <ScrollableList
      items={items}
      selectedIndex={selectedIndex}
      maxVisible={15}
      renderItem={(item, selected) => (
        <Text bold={selected} color={selected ? 'cyan' : 'white'}>
          {selected ? '> ' : '  '}{item.name}
        </Text>
      )}
      emptyText="No items found"
    />
  );
}
```

## Props

| Prop | Type | Description |
|------|------|-------------|
| `items` | `T[]` | Array of items to render |
| `selectedIndex` | `number` | Currently selected index |
| `maxVisible` | `number` | Max items visible at once |
| `renderItem` | `(item, selected, index) => ReactNode` | Render function per item |
| `emptyText` | `string?` | Text shown when items is empty |

## Requirements

- Ink >= 5.0.0
- React >= 18.0.0
```

- [ ] **Step 9: Commit**

```bash
git add packages/ink-scrollable-list/
git commit -m "feat(ink-scrollable-list): windowed scrollable list for Ink 5"
```

---

### Task 4: `@wrxck/ink-input-dispatcher` Package

A single-point input routing system for Ink apps. One `useInput` at the root, views register handlers.

**Files:**
- Create: `packages/ink-input-dispatcher/package.json`
- Create: `packages/ink-input-dispatcher/tsconfig.json`
- Create: `packages/ink-input-dispatcher/src/index.ts`
- Create: `packages/ink-input-dispatcher/src/dispatcher.tsx`
- Create: `packages/ink-input-dispatcher/src/types.ts`
- Create: `packages/ink-input-dispatcher/tests/dispatcher.test.tsx`
- Create: `packages/ink-input-dispatcher/README.md`

- [ ] **Step 1: Scaffold package.json**

```json
{
  "name": "@wrxck/ink-input-dispatcher",
  "version": "0.1.0",
  "description": "Single-point input routing for Ink 5 apps — no more competing useInput handlers",
  "type": "module",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "files": ["dist"],
  "scripts": {
    "build": "tsc",
    "test": "vitest run",
    "prepublishOnly": "npm run build"
  },
  "peerDependencies": {
    "ink": ">=5.0.0",
    "react": ">=18.0.0"
  },
  "devDependencies": {
    "ink": "^5.2.1",
    "react": "^18.3.1",
    "ink-testing-library": "^4.0.0",
    "vitest": "^3.1.1",
    "typescript": "^5.8.3"
  },
  "keywords": ["ink", "ink-component", "input", "keyboard", "dispatcher", "routing", "tui", "cli"],
  "license": "MIT",
  "repository": {
    "type": "git",
    "url": "https://github.com/wrxck/fleet.git",
    "directory": "packages/ink-input-dispatcher"
  }
}
```

- [ ] **Step 2: Create tsconfig.json**

```json
{
  "extends": "../../tsconfig.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src",
    "declaration": true,
    "jsx": "react-jsx"
  },
  "include": ["src"]
}
```

- [ ] **Step 3: Define types**

```typescript
// packages/ink-input-dispatcher/src/types.ts
import type { Key } from 'ink';

/**
 * Return true to indicate the input was consumed (stop further processing).
 * Return false/void to let it fall through to the next handler.
 */
export type InputHandler = (input: string, key: Key) => boolean | void;
```

- [ ] **Step 4: Write failing tests**

```tsx
// packages/ink-input-dispatcher/tests/dispatcher.test.tsx
import React, { useState } from 'react';
import { render } from 'ink-testing-library';
import { Text } from 'ink';
import { describe, it, expect } from 'vitest';
import { InputDispatcher, useRegisterHandler } from '../src/dispatcher.js';
import type { InputHandler } from '../src/types.js';

function TestView({ handler }: { handler: InputHandler }): React.JSX.Element {
  useRegisterHandler(handler);
  return <Text>view</Text>;
}

describe('InputDispatcher', () => {
  it('routes input to registered view handler', () => {
    let received = '';
    const handler: InputHandler = (input) => {
      received = input;
      return true;
    };

    const { stdin } = render(
      <InputDispatcher>
        <TestView handler={handler} />
      </InputDispatcher>
    );

    stdin.write('j');
    expect(received).toBe('j');
  });

  it('calls global handler first, skips view if consumed', () => {
    let viewCalled = false;
    const viewHandler: InputHandler = () => { viewCalled = true; return true; };
    const globalHandler: InputHandler = (input) => {
      if (input === 'q') return true; // consumed
      return false;
    };

    const { stdin } = render(
      <InputDispatcher globalHandler={globalHandler}>
        <TestView handler={viewHandler} />
      </InputDispatcher>
    );

    stdin.write('q');
    expect(viewCalled).toBe(false);
  });

  it('falls through to view handler when global does not consume', () => {
    let viewReceived = '';
    const viewHandler: InputHandler = (input) => { viewReceived = input; return true; };
    const globalHandler: InputHandler = () => false;

    const { stdin } = render(
      <InputDispatcher globalHandler={globalHandler}>
        <TestView handler={viewHandler} />
      </InputDispatcher>
    );

    stdin.write('j');
    expect(viewReceived).toBe('j');
  });
});
```

- [ ] **Step 5: Run tests, verify they fail**

```bash
cd packages/ink-input-dispatcher && npx vitest run
```

- [ ] **Step 6: Implement dispatcher**

```tsx
// packages/ink-input-dispatcher/src/dispatcher.tsx
import React, { createContext, useContext, useRef, useEffect, useCallback } from 'react';
import { useInput } from 'ink';
import type { Key } from 'ink';
import type { InputHandler } from './types.js';

const HandlerContext = createContext<React.MutableRefObject<InputHandler | null>>({
  current: null,
});

interface InputDispatcherProps {
  globalHandler?: InputHandler;
  children: React.ReactNode;
}

export function InputDispatcher({ globalHandler, children }: InputDispatcherProps): React.JSX.Element {
  const viewHandlerRef = useRef<InputHandler | null>(null);
  const globalRef = useRef(globalHandler);
  globalRef.current = globalHandler;

  useInput((input: string, key: Key) => {
    // Global handler first — if it returns true, input is consumed
    if (globalRef.current) {
      const consumed = globalRef.current(input, key);
      if (consumed) return;
    }

    // Fall through to active view handler
    if (viewHandlerRef.current) {
      viewHandlerRef.current(input, key);
    }
  });

  return (
    <HandlerContext.Provider value={viewHandlerRef}>
      {children}
    </HandlerContext.Provider>
  );
}

/**
 * Register the calling component's input handler as the active view handler.
 * Only one handler is active at a time — the last component to call this wins.
 * When the component unmounts, the handler is cleared.
 */
export function useRegisterHandler(handler: InputHandler): void {
  const ref = useContext(HandlerContext);
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    const wrappedHandler: InputHandler = (input, key) => handlerRef.current(input, key);
    ref.current = wrappedHandler;
    return () => {
      if (ref.current === wrappedHandler) {
        ref.current = null;
      }
    };
  }, [ref]);
}
```

- [ ] **Step 7: Create index.ts**

```typescript
// packages/ink-input-dispatcher/src/index.ts
export { InputDispatcher, useRegisterHandler } from './dispatcher.js';
export type { InputHandler } from './types.js';
```

- [ ] **Step 8: Run tests, verify they pass**

```bash
cd packages/ink-input-dispatcher && npx vitest run
```

- [ ] **Step 9: Write README**

```markdown
# @wrxck/ink-input-dispatcher

Single-point input routing for Ink 5 apps. Eliminates the "multiple useInput handlers fighting" problem.

## The Problem

In Ink, every component that calls `useInput()` receives ALL keypresses. When your app has a global keyboard handler AND per-view handlers AND list components with their own handlers, inputs get processed multiple times causing flickering, double-actions, and character duplication.

## The Solution

One `useInput` call at the root. Views register their handlers, and only the active view's handler receives input.

## Install

```bash
npm install @wrxck/ink-input-dispatcher
```

## Usage

```tsx
import { InputDispatcher, useRegisterHandler } from '@wrxck/ink-input-dispatcher';
import type { InputHandler } from '@wrxck/ink-input-dispatcher';

// Root app — one useInput, controlled routing
function App() {
  const globalHandler: InputHandler = (input, key) => {
    if (input === 'q') { process.exit(0); return true; }
    if (key.tab) { switchView(); return true; }
    return false; // not consumed — falls through to view
  };

  return (
    <InputDispatcher globalHandler={globalHandler}>
      <ActiveView />
    </InputDispatcher>
  );
}

// View — registers its handler, no useInput needed
function ListView() {
  const handler: InputHandler = (input, key) => {
    if (input === 'j' || key.downArrow) { moveDown(); return true; }
    if (input === 'k' || key.upArrow) { moveUp(); return true; }
    if (key.return) { select(); return true; }
    return false;
  };

  useRegisterHandler(handler);
  return <ScrollableList ... />;
}
```

## API

### `<InputDispatcher globalHandler? children />`

Wraps your app. Owns the single `useInput` call.

- `globalHandler`: Called first for every keypress. Return `true` to consume (prevent view handler from seeing it).

### `useRegisterHandler(handler)`

Registers the calling component as the active input handler. Only one handler active at a time. Cleans up on unmount.

## Requirements

- Ink >= 5.0.0
- React >= 18.0.0
```

- [ ] **Step 10: Commit**

```bash
git add packages/ink-input-dispatcher/
git commit -m "feat(ink-input-dispatcher): single-point input routing for Ink 5"
```

---

## Phase 2: Fleet TUI Overhaul

With the packages built, now rewire Fleet's TUI to use them.

### Task 5: Update Types and State

**Files:**
- Modify: `src/tui/types.ts`
- Modify: `src/tui/state.ts`

- [ ] **Step 1: Update TuiState type**

Add to `src/tui/types.ts`:

```typescript
export type View =
  | 'dashboard'
  | 'app-detail'
  | 'health'
  | 'secrets'
  | 'secret-edit'
  | 'logs';

export type SecretsSubView = 'app-list' | 'secret-list';

export interface TuiState {
  currentView: View;
  previousView: View | null;
  selectedApp: string | null;
  selectedSecret: string | null;
  redacted: boolean;
  loading: boolean;
  error: string | null;
  confirmAction: ConfirmAction | null;
  // Per-view selection indices
  dashboardIndex: number;
  healthIndex: number;
  secretsIndex: number;
  secretsSubView: SecretsSubView;
  appDetailIndex: number;
}

export interface ConfirmAction {
  label: string;
  description: string;
  onConfirm: () => void;
}

export type Action =
  | { type: 'NAVIGATE'; view: View }
  | { type: 'GO_BACK' }
  | { type: 'SELECT_APP'; app: string }
  | { type: 'SELECT_SECRET'; key: string | null }
  | { type: 'SET_LOADING'; loading: boolean }
  | { type: 'SET_ERROR'; error: string | null }
  | { type: 'TOGGLE_REDACT' }
  | { type: 'CONFIRM'; action: ConfirmAction }
  | { type: 'CANCEL_CONFIRM' }
  | { type: 'SET_INDEX'; view: string; index: number }
  | { type: 'SET_SECRETS_SUBVIEW'; subView: SecretsSubView };
```

- [ ] **Step 2: Update reducer and initialState**

In `src/tui/state.ts`, update `initialState`:

```typescript
export const initialState: TuiState = {
  currentView: 'dashboard',
  previousView: null,
  selectedApp: null,
  selectedSecret: null,
  redacted: false,
  loading: false,
  error: null,
  confirmAction: null,
  dashboardIndex: 0,
  healthIndex: 0,
  secretsIndex: 0,
  secretsSubView: 'app-list',
  appDetailIndex: 0,
};
```

Add cases to the reducer:

```typescript
case 'SET_INDEX': {
  const key = `${action.view}Index` as keyof TuiState;
  if (key in state) {
    return { ...state, [key]: action.index };
  }
  return state;
}
case 'SET_SECRETS_SUBVIEW':
  return { ...state, secretsSubView: action.subView, secretsIndex: 0 };
```

Also update `GO_BACK` to reset `secretsSubView`:

```typescript
case 'GO_BACK':
  return {
    ...state,
    currentView: state.previousView ?? 'dashboard',
    previousView: null,
    selectedSecret: null,
    secretsSubView: 'app-list',
    error: null,
    confirmAction: null,
  };
```

- [ ] **Step 3: Run existing tests to ensure nothing breaks**

```bash
npm test
```

- [ ] **Step 4: Commit**

```bash
git add src/tui/types.ts src/tui/state.ts
git commit -m "feat(tui): add per-view selection indices to state"
```

---

### Task 6: Install Packages and Create useTerminalSize Hook

**Files:**
- Modify: `package.json`
- Create: `src/tui/hooks/use-terminal-size.ts`
- Delete: `src/tui/hooks/use-keyboard.ts`

- [ ] **Step 1: Install the packages (from workspace)**

```bash
npm install
```

Since they're workspaces, they're already linked. Add them as dependencies in root `package.json`:

```json
"@wrxck/ink-viewport": "workspace:*",
"@wrxck/ink-scrollable-list": "workspace:*",
"@wrxck/ink-input-dispatcher": "workspace:*"
```

- [ ] **Step 2: Re-export useTerminalSize for convenience**

```typescript
// src/tui/hooks/use-terminal-size.ts
export { useTerminalSize, useAvailableHeight } from '@wrxck/ink-viewport';
```

- [ ] **Step 3: Commit**

```bash
git add package.json src/tui/hooks/use-terminal-size.ts
git commit -m "chore(tui): wire up ink packages from workspace"
```

---

### Task 7: Rewrite Router with InputDispatcher

**Files:**
- Modify: `src/tui/router.tsx`
- Delete: `src/tui/hooks/use-keyboard.ts` (absorbed into router)

- [ ] **Step 1: Rewrite router.tsx**

```tsx
// src/tui/router.tsx
import React, { useReducer, useState, useEffect, useCallback } from 'react';
import { Box, Text } from 'ink';
import { InputDispatcher } from '@wrxck/ink-input-dispatcher';
import type { InputHandler } from '@wrxck/ink-input-dispatcher';
import { Viewport } from '@wrxck/ink-viewport';
import { reducer, initialState, AppStateContext, AppDispatchContext, nextTopView } from './state.js';
import { Header } from './components/Header.js';
import { KeyHint } from './components/KeyHint.js';
import { Confirm } from './components/Confirm.js';
import { Dashboard } from './views/Dashboard.js';
import { AppDetail } from './views/AppDetail.js';
import { SecretsView } from './views/SecretsView.js';
import { SecretEdit } from './views/SecretEdit.js';
import { HealthView } from './views/HealthView.js';
import { LogsView } from './views/LogsView.js';
import { isSealed, isInitialized } from '../core/secrets.js';
import type { View } from './types.js';

function ViewRouter(): React.JSX.Element {
  const state = React.useContext(AppStateContext);

  switch (state.currentView) {
    case 'dashboard':
      return <Dashboard />;
    case 'app-detail':
      return <AppDetail />;
    case 'health':
      return <HealthView />;
    case 'secrets':
      return <SecretsView />;
    case 'secret-edit':
      return <SecretEdit />;
    case 'logs':
      return <LogsView />;
    default:
      return <Dashboard />;
  }
}

// Chrome = header border (2) + footer border (2) + error bar potential (2) = ~6 rows
const CHROME_ROWS = 6;

export function App(): React.JSX.Element {
  const [state, dispatch] = useReducer(reducer, initialState);
  const [vaultSealed, setVaultSealed] = useState(true);

  useEffect(() => {
    try {
      if (isInitialized()) {
        setVaultSealed(isSealed());
      }
    } catch {
      // vault may not be set up
    }

    const interval = setInterval(() => {
      try {
        if (isInitialized()) {
          const sealed = isSealed();
          setVaultSealed(prev => prev === sealed ? prev : sealed);
        }
      } catch {
        // ignore
      }
    }, 5000);

    return () => clearInterval(interval);
  }, []);

  const globalHandler: InputHandler = useCallback((input, key) => {
    // Confirm dialog takes priority
    if (state.confirmAction) {
      if (input === 'y' || input === 'Y') {
        state.confirmAction.onConfirm();
        dispatch({ type: 'CANCEL_CONFIRM' });
      } else if (input === 'n' || input === 'N' || key.escape) {
        dispatch({ type: 'CANCEL_CONFIRM' });
      }
      return true; // consume all input while confirm is active
    }

    // Quit
    if (input === 'q' && state.currentView !== 'secret-edit') {
      process.exit(0);
      return true;
    }

    // Redact toggle (not in text-input views)
    if (input === 'x' && state.currentView !== 'secret-edit') {
      dispatch({ type: 'TOGGLE_REDACT' });
      return true;
    }

    // Tab cycles top-level views
    if (key.tab) {
      const topViews: View[] = ['dashboard', 'health', 'secrets'];
      const base = topViews.includes(state.currentView)
        ? state.currentView
        : state.previousView ?? 'dashboard';
      dispatch({ type: 'NAVIGATE', view: nextTopView(base) });
      return true;
    }

    // Escape goes back (from sub-views)
    if (key.escape && state.previousView) {
      dispatch({ type: 'GO_BACK' });
      return true;
    }

    return false; // not consumed — falls through to view handler
  }, [state.confirmAction, state.currentView, state.previousView]);

  return (
    <AppStateContext.Provider value={state}>
      <AppDispatchContext.Provider value={dispatch}>
        <InputDispatcher globalHandler={globalHandler}>
          <Viewport chrome={CHROME_ROWS}>
            <Header vaultSealed={vaultSealed} />
            <Box flexGrow={1} flexDirection="column">
              <ViewRouter />
              <Confirm />
              {state.error && (
                <Box paddingX={1}>
                  <Box borderStyle="round" borderColor="red" paddingX={1}>
                    <Text color="red">{state.error}</Text>
                  </Box>
                </Box>
              )}
            </Box>
            <KeyHint />
          </Viewport>
        </InputDispatcher>
      </AppDispatchContext.Provider>
    </AppStateContext.Provider>
  );
}
```

- [ ] **Step 2: Delete use-keyboard.ts**

```bash
rm src/tui/hooks/use-keyboard.ts
```

- [ ] **Step 3: Run tests**

```bash
npm test
```

- [ ] **Step 4: Commit**

```bash
git add src/tui/router.tsx
git rm src/tui/hooks/use-keyboard.ts
git commit -m "feat(tui): single input dispatcher, remove competing useInput handlers"
```

---

### Task 8: Rewrite Dashboard View

**Files:**
- Modify: `src/tui/views/Dashboard.tsx`
- Delete: `src/tui/components/AppList.tsx` (replaced by package)

- [ ] **Step 1: Rewrite Dashboard.tsx**

```tsx
// src/tui/views/Dashboard.tsx
import React, { useMemo } from 'react';
import { Box, Text } from 'ink';
import Spinner from 'ink-spinner';
import { useRegisterHandler } from '@wrxck/ink-input-dispatcher';
import { ScrollableList } from '@wrxck/ink-scrollable-list';
import { useAvailableHeight } from '@wrxck/ink-viewport';
import type { InputHandler } from '@wrxck/ink-input-dispatcher';
import { useAppState, useAppDispatch, useRedact } from '../state.js';
import { useFleetData } from '../hooks/use-fleet-data.js';
import { colors } from '../theme.js';

export function Dashboard(): React.JSX.Element {
  const state = useAppState();
  const dispatch = useAppDispatch();
  const { status, loading, error } = useFleetData();
  const redact = useRedact();
  const availableHeight = useAvailableHeight();

  const items = useMemo(
    () => status?.apps.map(app => ({ ...app, name: app.name })) ?? [],
    [status],
  );

  const handler: InputHandler = (input, key) => {
    if (items.length === 0) return false;

    if (input === 'j' || key.downArrow) {
      dispatch({ type: 'SET_INDEX', view: 'dashboard', index: Math.min(state.dashboardIndex + 1, items.length - 1) });
      return true;
    }
    if (input === 'k' || key.upArrow) {
      dispatch({ type: 'SET_INDEX', view: 'dashboard', index: Math.max(state.dashboardIndex - 1, 0) });
      return true;
    }
    if (key.return) {
      const item = items[state.dashboardIndex];
      if (item) {
        dispatch({ type: 'SELECT_APP', app: item.name });
        dispatch({ type: 'NAVIGATE', view: 'app-detail' });
      }
      return true;
    }
    return false;
  };

  useRegisterHandler(handler);

  if (loading && !status) {
    return (
      <Box padding={1}>
        <Text><Spinner type="dots" /> Loading fleet status...</Text>
      </Box>
    );
  }

  if (error && !status) {
    return (
      <Box padding={1}>
        <Text color={colors.error}>Error: {error}</Text>
      </Box>
    );
  }

  if (!status) return <Text color={colors.muted}>No data</Text>;

  // 3 rows for summary + header row + margin
  const listHeight = Math.max(5, availableHeight - 4);

  return (
    <Box flexDirection="column" padding={1}>
      <Box marginBottom={1} gap={2}>
        <Text bold>{status.totalApps} apps</Text>
        <Text color={colors.success}>{status.healthy} healthy</Text>
        {status.unhealthy > 0 && (
          <Text color={colors.error}>{status.unhealthy} unhealthy</Text>
        )}
        {loading && <Text color={colors.muted}><Spinner type="dots" /></Text>}
      </Box>

      <Box marginBottom={1}>
        <Text bold>{'APP'.padEnd(24)}{'SYSTEMD'.padEnd(14)}{'CONTAINERS'.padEnd(14)}{'HEALTH'.padEnd(12)}</Text>
      </Box>

      <ScrollableList
        items={items}
        selectedIndex={Math.min(state.dashboardIndex, items.length - 1)}
        maxVisible={listHeight}
        renderItem={(item, selected) => {
          const app = status.apps.find(a => a.name === item.name)!;
          const displayName = redact(app.name);
          return (
            <Box>
              <Text bold color={selected ? colors.primary : colors.muted}>
                {selected ? '> ' : '  '}
              </Text>
              <Box width={24}>
                <Text bold={selected} color={selected ? colors.primary : colors.text}>
                  {displayName.length > 22 ? displayName.slice(0, 19) + '...' : displayName}
                </Text>
              </Box>
              <Box width={14}>
                <Text>{app.systemd.slice(0, 12)}</Text>
              </Box>
              <Box width={14}>
                <Text>{app.containers}</Text>
              </Box>
              <Box width={12}>
                <Text>{app.health.slice(0, 10)}</Text>
              </Box>
            </Box>
          );
        }}
      />
    </Box>
  );
}
```

- [ ] **Step 2: Delete AppList.tsx**

```bash
rm src/tui/components/AppList.tsx
```

- [ ] **Step 3: Run tests**

```bash
npm test
```

- [ ] **Step 4: Commit**

```bash
git add src/tui/views/Dashboard.tsx
git rm src/tui/components/AppList.tsx
git commit -m "feat(tui): rewrite dashboard with ScrollableList and input dispatcher"
```

---

### Task 9: Rewrite AppDetail View

**Files:**
- Modify: `src/tui/views/AppDetail.tsx`

- [ ] **Step 1: Rewrite AppDetail.tsx**

Move registry loading to `useEffect`, use `useRegisterHandler`, remove `useInput`.

```tsx
// src/tui/views/AppDetail.tsx
import React, { useState, useEffect } from 'react';
import { Box, Text } from 'ink';
import Spinner from 'ink-spinner';
import { useRegisterHandler } from '@wrxck/ink-input-dispatcher';
import type { InputHandler } from '@wrxck/ink-input-dispatcher';
import { useAppState, useAppDispatch, useRedact } from '../state.js';
import { runFleetCommand } from '../exec-bridge.js';
import { colors } from '../theme.js';
import { load, findApp } from '../../core/registry.js';
import type { AppEntry } from '../../core/registry.js';

interface ActionItem {
  key: string;
  label: string;
  command: string[];
  destructive?: boolean;
}

const ACTIONS: ActionItem[] = [
  { key: '1', label: 'Start', command: ['start'] },
  { key: '2', label: 'Stop', command: ['stop'], destructive: true },
  { key: '3', label: 'Restart', command: ['restart'] },
  { key: '4', label: 'Deploy', command: ['deploy'], destructive: true },
  { key: '5', label: 'Logs', command: ['logs'] },
];

export function AppDetail(): React.JSX.Element {
  const { selectedApp, redacted, appDetailIndex } = useAppState();
  const dispatch = useAppDispatch();
  const redact = useRedact();
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; output: string } | null>(null);
  const [app, setApp] = useState<AppEntry | undefined>(undefined);

  useEffect(() => {
    if (selectedApp) {
      try {
        const reg = load();
        setApp(findApp(reg, selectedApp));
      } catch {
        setApp(undefined);
      }
    }
  }, [selectedApp]);

  function executeAction(action: ActionItem) {
    if (!selectedApp) return;
    setRunning(true);
    setResult(null);
    runFleetCommand([...action.command, selectedApp]).then(res => {
      setResult(res);
      setRunning(false);
    });
  }

  const handler: InputHandler = (input, key) => {
    if (running) return false;

    if (input === 'j' || key.downArrow) {
      dispatch({ type: 'SET_INDEX', view: 'appDetail', index: Math.min(appDetailIndex + 1, ACTIONS.length - 1) });
      return true;
    }
    if (input === 'k' || key.upArrow) {
      dispatch({ type: 'SET_INDEX', view: 'appDetail', index: Math.max(appDetailIndex - 1, 0) });
      return true;
    }
    if (key.return) {
      const action = ACTIONS[appDetailIndex];
      if (action.command[0] === 'logs') {
        dispatch({ type: 'NAVIGATE', view: 'logs' });
        return true;
      }
      if (action.destructive) {
        dispatch({
          type: 'CONFIRM',
          action: {
            label: `${action.label} ${selectedApp}?`,
            description: `This will ${action.label.toLowerCase()} the ${selectedApp} service.`,
            onConfirm: () => executeAction(action),
          },
        });
      } else {
        executeAction(action);
      }
      return true;
    }
    return false;
  };

  useRegisterHandler(handler);

  if (!app) {
    return (
      <Box padding={1}>
        <Text color={colors.error}>App not found: {selectedApp}</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" padding={1}>
      <Text bold color={colors.primary}>{redact(app.displayName || app.name)}</Text>
      <Box marginY={1} flexDirection="column">
        <Text><Text color={colors.muted}>Type:      </Text>{app.type}</Text>
        <Text><Text color={colors.muted}>Service:   </Text>{redacted ? '***' : app.serviceName}</Text>
        <Text><Text color={colors.muted}>Compose:   </Text>{redacted ? '***' : app.composePath}</Text>
        {app.domains.length > 0 && (
          <Text><Text color={colors.muted}>Domains:   </Text>{redacted ? '***' : app.domains.join(', ')}</Text>
        )}
        {app.port && (
          <Text><Text color={colors.muted}>Port:      </Text>{app.port}</Text>
        )}
        <Text><Text color={colors.muted}>Containers:</Text> {redacted ? '***' : app.containers.join(', ')}</Text>
        {app.gitRepo && (
          <Text><Text color={colors.muted}>Git:       </Text>{redacted ? '***' : app.gitRepo}</Text>
        )}
      </Box>

      <Text bold>Actions</Text>
      <Box flexDirection="column" marginTop={1}>
        {ACTIONS.map((action, i) => {
          const selected = i === appDetailIndex;
          return (
            <Text key={action.key}>
              <Text color={colors.primary}>{selected ? '> ' : '  '}</Text>
              <Text bold={selected} color={selected ? colors.primary : colors.text}>
                [{action.key}] {action.label}
              </Text>
              {action.destructive && <Text color={colors.warning}> !</Text>}
            </Text>
          );
        })}
      </Box>

      {running && (
        <Box marginTop={1}>
          <Text><Spinner type="dots" /> Running...</Text>
        </Box>
      )}

      {result && (
        <Box marginTop={1} flexDirection="column">
          <Text color={result.ok ? colors.success : colors.error}>
            {result.ok ? 'Done' : 'Failed'}
          </Text>
          {result.output && (
            <Text color={colors.muted}>{result.output.trim().slice(0, 500)}</Text>
          )}
        </Box>
      )}
    </Box>
  );
}
```

- [ ] **Step 2: Run tests**

```bash
npm test
```

- [ ] **Step 3: Commit**

```bash
git add src/tui/views/AppDetail.tsx
git commit -m "feat(tui): rewrite app-detail with input dispatcher, effect-based registry load"
```

---

### Task 10: Rewrite HealthView

**Files:**
- Modify: `src/tui/views/HealthView.tsx`

- [ ] **Step 1: Rewrite HealthView.tsx**

Add `useRegisterHandler`, `useMemo` for counts, `ScrollableList` for results.

```tsx
// src/tui/views/HealthView.tsx
import React, { useMemo } from 'react';
import { Box, Text } from 'ink';
import Spinner from 'ink-spinner';
import { useRegisterHandler } from '@wrxck/ink-input-dispatcher';
import { ScrollableList } from '@wrxck/ink-scrollable-list';
import { useAvailableHeight } from '@wrxck/ink-viewport';
import type { InputHandler } from '@wrxck/ink-input-dispatcher';
import { useHealth } from '../hooks/use-health.js';
import { StatusBadge } from '../components/StatusBadge.js';
import { useAppState, useAppDispatch, useRedact } from '../state.js';
import { colors } from '../theme.js';

export function HealthView(): React.JSX.Element {
  const state = useAppState();
  const dispatch = useAppDispatch();
  const { results, loading, error } = useHealth();
  const redact = useRedact();
  const availableHeight = useAvailableHeight();

  const counts = useMemo(() => ({
    healthy: results.filter(r => r.overall === 'healthy').length,
    degraded: results.filter(r => r.overall === 'degraded').length,
    down: results.filter(r => r.overall === 'down').length,
  }), [results]);

  const handler: InputHandler = (input, key) => {
    if (results.length === 0) return false;

    if (input === 'j' || key.downArrow) {
      dispatch({ type: 'SET_INDEX', view: 'health', index: Math.min(state.healthIndex + 1, results.length - 1) });
      return true;
    }
    if (input === 'k' || key.upArrow) {
      dispatch({ type: 'SET_INDEX', view: 'health', index: Math.max(state.healthIndex - 1, 0) });
      return true;
    }
    return false;
  };

  useRegisterHandler(handler);

  if (loading && results.length === 0) {
    return (
      <Box padding={1}>
        <Text><Spinner type="dots" /> Running health checks...</Text>
      </Box>
    );
  }

  if (error && results.length === 0) {
    return (
      <Box padding={1}>
        <Text color={colors.error}>Error: {error}</Text>
      </Box>
    );
  }

  const listHeight = Math.max(5, availableHeight - 4);

  return (
    <Box flexDirection="column" padding={1}>
      <Box marginBottom={1} gap={2}>
        <Text bold>Health Monitor</Text>
        <Text color={colors.success}>{counts.healthy} healthy</Text>
        {counts.degraded > 0 && <Text color={colors.warning}>{counts.degraded} degraded</Text>}
        {counts.down > 0 && <Text color={colors.error}>{counts.down} down</Text>}
        {loading && <Text color={colors.muted}><Spinner type="dots" /></Text>}
      </Box>

      <Text bold>
        {'  APP'.padEnd(26)}{'SYSTEMD'.padEnd(12)}{'CONTAINERS'.padEnd(20)}{'HTTP'.padEnd(10)}OVERALL
      </Text>

      <ScrollableList
        items={results}
        selectedIndex={Math.min(state.healthIndex, results.length - 1)}
        maxVisible={listHeight}
        renderItem={(result, selected) => {
          const runningCount = result.containers.filter(c => c.running).length;
          const containerStr = `${runningCount}/${result.containers.length}`;
          const httpStr = result.http
            ? result.http.ok ? `${result.http.status}` : 'err'
            : 'n/a';

          return (
            <Box>
              <Text bold color={selected ? colors.primary : colors.muted}>
                {selected ? '> ' : '  '}
              </Text>
              <Text>{redact(result.app).padEnd(24)}</Text>
              <Box width={12}>
                <StatusBadge value={result.systemd.state} type="systemd" />
              </Box>
              <Text>{containerStr.padEnd(20)}</Text>
              <Box width={10}>
                <Text color={result.http?.ok ? colors.success : result.http ? colors.error : colors.muted}>
                  {httpStr}
                </Text>
              </Box>
              <StatusBadge value={result.overall} type="health" />
            </Box>
          );
        }}
      />
    </Box>
  );
}
```

- [ ] **Step 2: Run tests**

```bash
npm test
```

- [ ] **Step 3: Commit**

```bash
git add src/tui/views/HealthView.tsx
git commit -m "feat(tui): rewrite health view with ScrollableList and input dispatcher"
```

---

### Task 11: Rewrite SecretsView

**Files:**
- Modify: `src/tui/views/SecretsView.tsx`

- [ ] **Step 1: Rewrite SecretsView.tsx**

Use `useRegisterHandler`, global state for `secretsIndex` and `secretsSubView`, `ScrollableList`, fix stale `useEffect` dep.

```tsx
// src/tui/views/SecretsView.tsx
import React, { useEffect, useCallback } from 'react';
import { Box, Text } from 'ink';
import { useRegisterHandler } from '@wrxck/ink-input-dispatcher';
import { ScrollableList } from '@wrxck/ink-scrollable-list';
import { useAvailableHeight } from '@wrxck/ink-viewport';
import type { InputHandler } from '@wrxck/ink-input-dispatcher';
import { useAppState, useAppDispatch, useRedact } from '../state.js';
import { useSecrets } from '../hooks/use-secrets.js';
import { colors } from '../theme.js';

export function SecretsView(): React.JSX.Element {
  const state = useAppState();
  const dispatch = useAppDispatch();
  const redact = useRedact();
  const secrets = useSecrets();
  const availableHeight = useAvailableHeight();
  const { secretsSubView: subView, secretsIndex: selectedIndex, selectedApp } = state;

  const refresh = secrets.refresh;
  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    if (subView === 'secret-list' && selectedApp) {
      secrets.loadAppSecrets(selectedApp);
    }
  }, [subView, selectedApp, secrets.loadAppSecrets]);

  const handler: InputHandler = useCallback((input, key) => {
    if (subView === 'app-list') {
      if (input === 'j' || key.downArrow) {
        dispatch({ type: 'SET_INDEX', view: 'secrets', index: Math.min(selectedIndex + 1, secrets.apps.length - 1) });
        return true;
      }
      if (input === 'k' || key.upArrow) {
        dispatch({ type: 'SET_INDEX', view: 'secrets', index: Math.max(selectedIndex - 1, 0) });
        return true;
      }
      if (key.return && secrets.apps[selectedIndex]) {
        dispatch({ type: 'SELECT_APP', app: secrets.apps[selectedIndex].app });
        dispatch({ type: 'SET_SECRETS_SUBVIEW', subView: 'secret-list' });
        return true;
      }
      if (input === 'u') {
        const result = secrets.unseal();
        if (!result.ok) {
          dispatch({ type: 'SET_ERROR', error: result.error ?? 'Unseal failed' });
        }
        secrets.refresh();
        return true;
      }
      if (input === 'l') {
        const result = secrets.seal();
        if (!result.ok) {
          dispatch({ type: 'SET_ERROR', error: result.error ?? 'Seal failed' });
        }
        secrets.refresh();
        return true;
      }
    } else if (subView === 'secret-list') {
      if (input === 'j' || key.downArrow) {
        dispatch({ type: 'SET_INDEX', view: 'secrets', index: Math.min(selectedIndex + 1, secrets.secrets.length - 1) });
        return true;
      }
      if (input === 'k' || key.upArrow) {
        dispatch({ type: 'SET_INDEX', view: 'secrets', index: Math.max(selectedIndex - 1, 0) });
        return true;
      }
      if (key.return && secrets.secrets[selectedIndex] && selectedApp) {
        dispatch({ type: 'SELECT_SECRET', key: secrets.secrets[selectedIndex].key });
        dispatch({ type: 'NAVIGATE', view: 'secret-edit' });
        return true;
      }
      if (key.escape) {
        dispatch({ type: 'SET_SECRETS_SUBVIEW', subView: 'app-list' });
        return true;
      }
      if (input === 'a' && selectedApp) {
        dispatch({ type: 'SELECT_SECRET', key: null });
        dispatch({ type: 'NAVIGATE', view: 'secret-edit' });
        return true;
      }
      if (input === 'd' && selectedApp && secrets.secrets[selectedIndex]) {
        const secretKey = secrets.secrets[selectedIndex].key;
        dispatch({
          type: 'CONFIRM',
          action: {
            label: `Delete secret "${secretKey}"?`,
            description: `This will remove ${secretKey} from ${redact(selectedApp)}'s vault.`,
            onConfirm: () => {
              const result = secrets.deleteSecret(selectedApp, secretKey);
              if (result.ok) {
                secrets.loadAppSecrets(selectedApp);
                secrets.refresh();
              } else {
                dispatch({ type: 'SET_ERROR', error: result.error ?? 'Delete failed' });
              }
            },
          },
        });
        return true;
      }
      if (input === 'r' && selectedApp && secrets.secrets[selectedIndex]) {
        const secretKey = secrets.secrets[selectedIndex].key;
        if (secrets.revealedValues[secretKey]) {
          secrets.hideSecret(secretKey);
        } else {
          secrets.revealSecret(selectedApp, secretKey);
        }
        return true;
      }
    }
    return false;
  }, [subView, selectedIndex, selectedApp, secrets, dispatch, redact]);

  useRegisterHandler(handler);

  const listHeight = Math.max(5, availableHeight - 5);

  return (
    <Box flexDirection="column" padding={1}>
      <Box marginBottom={1} paddingX={1} gap={2}>
        <Text bold>Vault:</Text>
        {!secrets.initialized ? (
          <Text color={colors.error}>Not initialized</Text>
        ) : secrets.sealed ? (
          <Text color={colors.warning} bold>SEALED</Text>
        ) : (
          <Text color={colors.success} bold>UNSEALED</Text>
        )}
        <Text color={colors.muted}>
          {secrets.apps.length} apps | {secrets.apps.reduce((sum, a) => sum + a.keyCount, 0)} keys
        </Text>
      </Box>

      {secrets.error && (
        <Box marginBottom={1}>
          <Text color={colors.error}>{secrets.error}</Text>
        </Box>
      )}

      {subView === 'app-list' ? (
        <Box flexDirection="column">
          <Text bold>Apps with secrets:</Text>
          <ScrollableList
            items={secrets.apps}
            selectedIndex={Math.min(selectedIndex, secrets.apps.length - 1)}
            maxVisible={listHeight}
            emptyText="  No secrets managed"
            renderItem={(app, selected) => (
              <Box>
                <Text color={colors.primary}>{selected ? '> ' : '  '}</Text>
                <Text bold={selected} color={selected ? colors.primary : colors.text}>
                  {redact(app.app).padEnd(24)}
                </Text>
                <Text color={colors.muted}>{app.type.padEnd(14)}</Text>
                <Text>{String(app.keyCount).padEnd(8)} keys</Text>
              </Box>
            )}
          />
        </Box>
      ) : (
        <Box flexDirection="column">
          <Text bold color={colors.primary}>{redact(selectedApp ?? '')}</Text>
          <Box marginTop={1} flexDirection="column">
            <ScrollableList
              items={secrets.secrets}
              selectedIndex={Math.min(selectedIndex, secrets.secrets.length - 1)}
              maxVisible={listHeight}
              emptyText="  No secrets found"
              renderItem={(secret, selected) => {
                const revealed = secrets.revealedValues[secret.key];
                return (
                  <Box>
                    <Text color={colors.primary}>{selected ? '> ' : '  '}</Text>
                    <Text bold={selected} color={selected ? colors.primary : colors.text}>
                      {secret.key.padEnd(30)}
                    </Text>
                    <Text color={revealed ? colors.warning : colors.muted}>
                      {revealed ?? secret.maskedValue}
                    </Text>
                  </Box>
                );
              }}
            />
          </Box>
        </Box>
      )}
    </Box>
  );
}
```

- [ ] **Step 2: Run tests**

```bash
npm test
```

- [ ] **Step 3: Commit**

```bash
git add src/tui/views/SecretsView.tsx
git commit -m "feat(tui): rewrite secrets view with ScrollableList, fix stale deps"
```

---

### Task 12: Rewrite SecretEdit View

**Files:**
- Modify: `src/tui/views/SecretEdit.tsx`

- [ ] **Step 1: Rewrite SecretEdit.tsx**

Replace `useInput` with `useRegisterHandler`. Note: `TextInput` from ink-text-input internally uses `useInput` — this is fine because it only activates when focused and handles its own text editing. Our handler only needs to catch Escape.

```tsx
// src/tui/views/SecretEdit.tsx
import React, { useState, useEffect } from 'react';
import { Box, Text } from 'ink';
import TextInput from 'ink-text-input';
import { useRegisterHandler } from '@wrxck/ink-input-dispatcher';
import type { InputHandler } from '@wrxck/ink-input-dispatcher';
import { useAppState, useAppDispatch } from '../state.js';
import { useSecrets } from '../hooks/use-secrets.js';
import { getSecret as getCoreSecret } from '../../core/secrets-ops.js';
import { colors } from '../theme.js';

export function SecretEdit(): React.JSX.Element {
  const { selectedApp, selectedSecret } = useAppState();
  const dispatch = useAppDispatch();
  const secrets = useSecrets();

  const isNew = selectedSecret === null;
  const [keyName, setKeyName] = useState(selectedSecret ?? '');
  const [value, setValue] = useState('');
  const [phase, setPhase] = useState<'key' | 'value'>(isNew ? 'key' : 'value');
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    if (!isNew && selectedApp && selectedSecret) {
      try {
        const existing = getCoreSecret(selectedApp, selectedSecret);
        if (existing) setValue(existing);
      } catch {
        // ignore
      }
    }
  }, [isNew, selectedApp, selectedSecret]);

  const save = () => {
    if (!selectedApp || !keyName) return;
    const result = secrets.saveSecret(selectedApp, keyName, value);
    if (result.ok) {
      setStatus('Saved and re-sealed');
      setTimeout(() => {
        dispatch({ type: 'GO_BACK' });
      }, 500);
    } else {
      setStatus(`Error: ${result.error}`);
    }
  };

  // SecretEdit handler: only Escape. TextInput handles its own input internally.
  const handler: InputHandler = (_input, key) => {
    if (key.escape) {
      dispatch({ type: 'GO_BACK' });
      return true;
    }
    return false;
  };

  useRegisterHandler(handler);

  return (
    <Box flexDirection="column" padding={1}>
      <Text bold color={colors.primary}>
        {isNew ? 'Add Secret' : 'Edit Secret'} - {selectedApp}
      </Text>

      <Box marginTop={1} flexDirection="column" gap={1}>
        <Box>
          <Text color={colors.muted}>Key:   </Text>
          {isNew && phase === 'key' ? (
            <TextInput
              value={keyName}
              onChange={setKeyName}
              onSubmit={() => {
                if (keyName) setPhase('value');
              }}
            />
          ) : (
            <Text bold>{keyName}</Text>
          )}
        </Box>

        <Box>
          <Text color={colors.muted}>Value: </Text>
          {phase === 'value' ? (
            <TextInput
              value={value}
              onChange={setValue}
              onSubmit={save}
            />
          ) : (
            <Text color={colors.muted}>(press Enter on key first)</Text>
          )}
        </Box>
      </Box>

      {status && (
        <Box marginTop={1}>
          <Text color={status.startsWith('Error') ? colors.error : colors.success}>
            {status}
          </Text>
        </Box>
      )}

      <Box marginTop={1}>
        <Text color={colors.muted}>Enter to save | Esc to cancel</Text>
      </Box>
    </Box>
  );
}
```

- [ ] **Step 2: Run tests**

```bash
npm test
```

- [ ] **Step 3: Commit**

```bash
git add src/tui/views/SecretEdit.tsx
git commit -m "feat(tui): rewrite secret-edit with input dispatcher"
```

---

### Task 13: Rewrite LogsView

**Files:**
- Modify: `src/tui/views/LogsView.tsx`

- [ ] **Step 1: Rewrite LogsView.tsx**

Use `useRegisterHandler`, terminal-aware viewport, remove `useInput`.

```tsx
// src/tui/views/LogsView.tsx
import React, { useState, useEffect, useRef } from 'react';
import { Box, Text } from 'ink';
import Spinner from 'ink-spinner';
import { useRegisterHandler } from '@wrxck/ink-input-dispatcher';
import { useAvailableHeight } from '@wrxck/ink-viewport';
import type { InputHandler } from '@wrxck/ink-input-dispatcher';
import { useAppState, useAppDispatch, useRedact } from '../state.js';
import { runFleetCommand, streamFleetCommand, type StreamHandle } from '../exec-bridge.js';
import { colors } from '../theme.js';

const MAX_LINES = 200;

export function LogsView(): React.JSX.Element {
  const { selectedApp } = useAppState();
  const dispatch = useAppDispatch();
  const redact = useRedact();
  const availableHeight = useAvailableHeight();
  const [lines, setLines] = useState<string[]>([]);
  const [following, setFollowing] = useState(false);
  const [loading, setLoading] = useState(true);
  const streamRef = useRef<StreamHandle | null>(null);

  useEffect(() => {
    if (!selectedApp) return;
    setLoading(true);
    runFleetCommand(['logs', selectedApp]).then(result => {
      if (result.ok) {
        setLines(result.output.split('\n').slice(-MAX_LINES));
      } else {
        setLines([`Error: ${result.output}`]);
      }
      setLoading(false);
    });

    return () => {
      if (streamRef.current) {
        streamRef.current.kill();
        streamRef.current = null;
      }
    };
  }, [selectedApp]);

  const handler: InputHandler = (input, key) => {
    if (input === 'f') {
      if (following) {
        if (streamRef.current) {
          streamRef.current.kill();
          streamRef.current = null;
        }
        setFollowing(false);
      } else if (selectedApp) {
        setFollowing(true);
        const handle = streamFleetCommand(['logs', selectedApp, '-f']);
        streamRef.current = handle;
        handle.onData((line) => {
          setLines(prev => [...prev.slice(-MAX_LINES + 1), line]);
        });
      }
      return true;
    }
    if (key.escape) {
      if (streamRef.current) {
        streamRef.current.kill();
        streamRef.current = null;
      }
      dispatch({ type: 'GO_BACK' });
      return true;
    }
    return false;
  };

  useRegisterHandler(handler);

  if (loading) {
    return (
      <Box padding={1}>
        <Text><Spinner type="dots" /> Loading logs for {selectedApp}...</Text>
      </Box>
    );
  }

  // Use terminal height minus chrome for header/title/footer
  const visibleCount = Math.max(5, availableHeight - 3);
  const visibleLines = lines.slice(-visibleCount);

  return (
    <Box flexDirection="column" padding={1}>
      <Box marginBottom={1} gap={2}>
        <Text bold color={colors.primary}>Logs: {redact(selectedApp ?? '')}</Text>
        {following && (
          <Text color={colors.success}><Spinner type="dots" /> following</Text>
        )}
      </Box>

      <Box flexDirection="column">
        {visibleLines.map((line, i) => (
          <Text key={i} wrap="truncate">{line}</Text>
        ))}
      </Box>
    </Box>
  );
}
```

- [ ] **Step 2: Run tests**

```bash
npm test
```

- [ ] **Step 3: Commit**

```bash
git add src/tui/views/LogsView.tsx
git commit -m "feat(tui): rewrite logs view with input dispatcher, terminal-aware viewport"
```

---

### Task 14: Clean Up and Integration Test

**Files:**
- Remove any dead imports across all files
- Verify full build

- [ ] **Step 1: Build packages**

```bash
cd packages/ink-viewport && npm run build
cd ../ink-scrollable-list && npm run build
cd ../ink-input-dispatcher && npm run build
```

- [ ] **Step 2: Build fleet**

```bash
npm run build
```

- [ ] **Step 3: Run all tests**

```bash
npm test
```

- [ ] **Step 4: Run the TUI manually to verify**

```bash
node dist/index.js tui
```

Verify:
- Dashboard renders with scrollable list
- j/k scrolls smoothly without flickering
- No character duplication
- Tab switches views
- Selection persists across data refreshes
- Escape navigates back
- Secrets subview state persists
- Logs use full terminal height
- Resize terminal — logs and lists adapt

- [ ] **Step 5: Commit any cleanup**

```bash
git add -p  # stage specific fixes
git commit -m "chore(tui): clean up dead imports and integration fixes"
```

---

### Task 15: Package READMEs and Publish Prep

**Files:**
- Verify: `packages/*/README.md`
- Verify: `packages/*/package.json`

- [ ] **Step 1: Verify each package builds independently**

```bash
for pkg in ink-viewport ink-scrollable-list ink-input-dispatcher; do
  echo "=== $pkg ==="
  cd packages/$pkg && npm run build && npm run test && cd ../..
done
```

- [ ] **Step 2: Verify package.json fields for npm publish**

Check each package has: name, version, description, main, types, files, keywords, license, repository, peerDependencies.

- [ ] **Step 3: Commit**

```bash
git add packages/
git commit -m "chore: finalize ink packages for publish"
```
