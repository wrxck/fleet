# Getting Started

## Installation

Install individual packages as needed:

```bash
npm install @matthesketh/ink-viewport @matthesketh/ink-scrollable-list @matthesketh/ink-input-dispatcher
```

All packages have peer dependencies on `ink` (>=5.0.0) and `react` (>=18.0.0):

```bash
npm install ink react
```

## Quick Start

Here's a minimal Ink app using three core packages:

```tsx
import React, { useState, useCallback } from 'react';
import { render, Box, Text } from 'ink';
import { InputDispatcher } from '@matthesketh/ink-input-dispatcher';
import type { InputHandler } from '@matthesketh/ink-input-dispatcher';
import { Viewport, useAvailableHeight } from '@matthesketh/ink-viewport';
import { ScrollableList } from '@matthesketh/ink-scrollable-list';

const items = Array.from({ length: 50 }, (_, i) => `Item ${i + 1}`);

function App() {
  const [selected, setSelected] = useState(0);
  const height = useAvailableHeight();

  const handler: InputHandler = useCallback((input, key) => {
    if (input === 'j' || key.downArrow) {
      setSelected(i => Math.min(i + 1, items.length - 1));
      return true;
    }
    if (input === 'k' || key.upArrow) {
      setSelected(i => Math.max(i - 1, 0));
      return true;
    }
    if (input === 'q') {
      process.exit(0);
      return true;
    }
    return false;
  }, []);

  return (
    <InputDispatcher globalHandler={handler}>
      <Viewport chrome={2}>
        <Text bold>My App</Text>
        <ScrollableList
          items={items}
          selectedIndex={selected}
          maxVisible={height - 1}
          renderItem={(item, isSelected) => (
            <Text bold={isSelected} color={isSelected ? 'cyan' : 'white'}>
              {isSelected ? '> ' : '  '}{item}
            </Text>
          )}
        />
      </Viewport>
    </InputDispatcher>
  );
}

render(<App />);
```

This gives you:
- Terminal-aware viewport that adapts to window size
- Windowed scrollable list that handles 50+ items smoothly
- Single input dispatcher — no competing `useInput` handlers

## The Input Dispatcher Pattern

The most important architectural decision in an Ink app is **how you handle keyboard input**. Ink's built-in `useInput` hook has a critical flaw: every component that calls it receives ALL keypresses. When multiple components listen, you get flickering, double-actions, and character duplication.

**@matthesketh/ink-input-dispatcher** solves this with a single `useInput` at the root:

```tsx
import { InputDispatcher, useRegisterHandler } from '@matthesketh/ink-input-dispatcher';

// root: one useInput, controlled routing
function App() {
  const globalHandler = (input, key) => {
    if (input === 'q') { process.exit(0); return true; }
    return false; // not consumed, falls through to view
  };

  return (
    <InputDispatcher globalHandler={globalHandler}>
      <CurrentView />
    </InputDispatcher>
  );
}

// view: registers its handler, no useInput needed
function ListView() {
  useRegisterHandler((input, key) => {
    if (input === 'j') { moveDown(); return true; }
    if (input === 'k') { moveUp(); return true; }
    return false;
  });

  return <ScrollableList ... />;
}
```

Global handler runs first. If it returns `true`, input is consumed. Otherwise, the active view's handler gets it. Clean, predictable, no conflicts.

## Next Steps

- Browse the [component catalogue](/packages/core/ink-viewport) to see what's available
- Read the [architecture guide](/guide/architecture) to understand how packages compose
- Check [why @matthesketh/ink](/guide/why) for a comparison with alternatives
