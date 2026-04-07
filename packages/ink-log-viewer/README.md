# @wrxck/ink-log-viewer

A rolling log display component for [Ink 5](https://github.com/vadimdemedes/ink) with auto-scroll, filtering, and timestamps. Like blessed-contrib's rolling log but for Ink.

## Install

```sh
npm install @wrxck/ink-log-viewer
```

## Usage

```tsx
import React, { useState } from 'react';
import { render } from 'ink';
import { LogViewer, type LogLine } from '@wrxck/ink-log-viewer';

function App() {
  const [lines] = useState<LogLine[]>([
    { text: 'Server started', level: 'info', timestamp: new Date() },
    { text: 'Listening on :3000', level: 'info', timestamp: new Date() },
    { text: 'Connection timeout', level: 'warn', timestamp: new Date() },
  ]);

  return (
    <LogViewer
      lines={lines}
      height={10}
      showTimestamps
      showLevel
    />
  );
}

render(<App />);
```

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `lines` | `LogLine[]` | required | Array of log lines to display |
| `height` | `number` | required | Number of visible rows |
| `showTimestamps` | `boolean` | `false` | Show `HH:MM:SS` timestamp prefix (dimmed) |
| `showLevel` | `boolean` | `false` | Show coloured level badge |
| `filter` | `string` | — | Case-insensitive substring filter |
| `autoScroll` | `boolean` | `true` | Pin view to newest lines |
| `wrap` | `boolean` | `true` | Wrap long lines (false = truncate) |

## LogLine

```ts
interface LogLine {
  text: string;
  timestamp?: Date;
  level?: 'info' | 'warn' | 'error' | 'debug';
}
```

## Level badges

- **INFO** — blue
- **WARN** — yellow
- **ERR** — red
- **DBG** — dimmed

## License

MIT
