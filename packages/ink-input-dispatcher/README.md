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

function App() {
  const globalHandler: InputHandler = (input, key) => {
    if (input === 'q') { process.exit(0); return true; }
    if (key.tab) { switchView(); return true; }
    return false;
  };

  return (
    <InputDispatcher globalHandler={globalHandler}>
      <ActiveView />
    </InputDispatcher>
  );
}

function ListView() {
  const handler: InputHandler = (input, key) => {
    if (input === 'j' || key.downArrow) { moveDown(); return true; }
    if (input === 'k' || key.upArrow) { moveUp(); return true; }
    return false;
  };

  useRegisterHandler(handler);
  return <ScrollableList ... />;
}
```

## API

### `<InputDispatcher globalHandler? children />`

Wraps your app. Owns the single `useInput` call.

- `globalHandler`: Called first for every keypress. Return `true` to consume.

### `useRegisterHandler(handler)`

Registers the calling component as the active input handler. Only one handler active at a time. Cleans up on unmount.

## Requirements

- Ink >= 5.0.0
- React >= 18.0.0
