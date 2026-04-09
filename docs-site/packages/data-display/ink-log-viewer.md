# ink-log-viewer

Rolling log display component for Ink 5 with auto-scroll, filtering, and timestamps.

## Installation

```bash
npm install @matthesketh/ink-log-viewer
```

Peer dependencies: `ink` (>=5.0.0), `react` (>=18.0.0).

## Usage

```tsx
import React, { useState, useEffect } from 'react';
import { render, Box } from 'ink';
import { LogViewer } from '@matthesketh/ink-log-viewer';
import type { LogLine } from '@matthesketh/ink-log-viewer';

function App() {
  const [logs, setLogs] = useState<LogLine[]>([]);

  useEffect(() => {
    const interval = setInterval(() => {
      setLogs(prev => [
        ...prev,
        {
          text: `Request processed in ${Math.floor(Math.random() * 200)}ms`,
          timestamp: new Date(),
          level: 'info',
        },
      ]);
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  return (
    <LogViewer
      lines={logs}
      height={15}
      showTimestamps
      showLevel
      autoScroll
    />
  );
}

render(<App />);
```

## LogLine Type

```ts
interface LogLine {
  text: string;
  timestamp?: Date;
  level?: 'info' | 'warn' | 'error' | 'debug';
}
```

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `lines` | `LogLine[]` | **(required)** | Array of log lines to display. |
| `height` | `number` | **(required)** | Number of visible rows. |
| `showTimestamps` | `boolean` | `false` | Show `HH:MM:SS` timestamps (only for lines that have a `timestamp`). |
| `showLevel` | `boolean` | `false` | Show a coloured level badge (`INFO`, `WARN`, `ERR`, `DBG`). |
| `filter` | `string` | `undefined` | Case-insensitive substring filter. Only lines whose `text` contains the filter string are shown. |
| `autoScroll` | `boolean` | `true` | When `true`, shows the most recent `height` lines (tail). When `false`, shows the first `height` lines (head). |
| `wrap` | `boolean` | `true` | Whether long lines wrap or are truncated. |

## Examples

### Filtered error view

```tsx
<LogViewer
  lines={logs}
  height={10}
  showLevel
  filter="error"
/>
```

### Static log (no auto-scroll)

```tsx
<LogViewer
  lines={logs}
  height={20}
  autoScroll={false}
  showTimestamps
/>
```

This displays the first 20 lines instead of tailing the latest entries.

## Notes

- Level badges are colour-coded: `INFO` (blue), `WARN` (yellow), `ERR` (red), `DBG` (dimmed).
- Timestamps are formatted as `HH:MM:SS` using the `Date` object on each `LogLine`.
- Filtering is applied before the height slice, so the visible window always contains `height` matching lines (or fewer if not enough match).
- The component does not manage scroll position or keyboard input. For interactive scrolling, manage the `lines` slice externally.
