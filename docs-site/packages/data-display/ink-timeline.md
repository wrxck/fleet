# ink-timeline

A vertical timeline component for displaying chronological events in the terminal.

## Installation

```bash
npm install @matthesketh/ink-timeline
```

Peer dependencies: `ink` (>=5.0.0), `react` (>=18.0.0).

## Usage

```tsx
import React from 'react';
import { render } from 'ink';
import { Timeline } from '@matthesketh/ink-timeline';

function App() {
  const events = [
    {
      time: new Date('2026-04-07T14:30:00'),
      type: 'deploy',
      title: 'Deployed v2.1.0',
      description: 'Production rollout complete',
    },
    {
      time: new Date('2026-04-07T13:15:00'),
      type: 'alert',
      title: 'CPU spike detected',
      description: 'web-01 reached 95% CPU',
    },
    {
      time: '2026-04-07T12:00:00Z',
      type: 'restart',
      title: 'Service restarted',
    },
    {
      time: '2026-04-07T10:00:00Z',
      type: 'info',
      title: 'Health check passed',
    },
  ];

  return <Timeline events={events} maxVisible={5} showRelativeTime />;
}

render(<App />);
```

## Props

### `TimelineProps`

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `events` | `TimelineEvent[]` | **(required)** | Array of events to display. |
| `maxVisible` | `number` | `undefined` | Limit the number of visible events. When set, shows arrow indicators for hidden events. |
| `showRelativeTime` | `boolean` | `false` | Display timestamps as relative time (e.g. "5m ago") instead of absolute. |

### `TimelineEvent`

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `time` | `string \| Date` | **(required)** | Timestamp for the event. Strings are parsed with `new Date()`. |
| `type` | `string` | `undefined` | Event type label (displayed uppercased in brackets). Also determines auto-colour if `typeColor` is not set. |
| `typeColor` | `string` | `undefined` | Explicit colour override for the type badge. Any Ink-supported colour string. |
| `title` | `string` | **(required)** | Main text for the event. |
| `description` | `string` | `undefined` | Secondary line displayed below the title, dimmed. |

## Examples

### Basic timeline

```tsx
<Timeline events={[
  { time: '12:30', title: 'Server started' },
  { time: '12:35', title: 'First request received' },
]} />
```

### With max visible and relative time

```tsx
<Timeline events={events} maxVisible={3} showRelativeTime />
```

When there are more events than `maxVisible`, the component displays arrow indicators and a count of hidden events.

### Custom type colours

```tsx
<Timeline events={[
  { time: new Date(), type: 'deploy', typeColor: 'magenta', title: 'Custom colour' },
]} />
```

## Notes

- Events are automatically sorted newest-first regardless of input order.
- The following event types have automatic colours when `typeColor` is not set:
  - `deploy` -- green
  - `restart` -- yellow
  - `alert` / `error` -- red
  - `info` -- blue
  - Any other type defaults to white.
- When `showRelativeTime` is `true`, string timestamps are parsed via `new Date()` before computing the relative offset.
- The component is display-only and does not handle keyboard input.
