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
    <Viewport chrome={4}>
      <ScrollableContent />
    </Viewport>
  );
}

function ScrollableContent() {
  const height = useAvailableHeight();
  return <Box height={height}>...</Box>;
}
```

## Requirements

- Ink >= 5.0.0
- React >= 18.0.0
