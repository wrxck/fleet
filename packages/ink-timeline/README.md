# @matthesketh/ink-timeline

Chronological event timeline display for Ink 5. Shows events with timestamps, type badges, and descriptions -- ideal for deploy history, incident logs, audit trails.

## Install

```bash
npm install @matthesketh/ink-timeline
```

## Usage

```tsx
import React from 'react';
import { render } from 'ink';
import { Timeline } from '@matthesketh/ink-timeline';

const events = [
  { time: '10:00', title: 'Deployed v1.2.3', type: 'deploy' },
  { time: '10:15', title: 'Service restarted', type: 'restart' },
  { time: '10:30', title: 'CPU spike detected', type: 'alert', description: 'CPU usage above 90%' },
];

render(<Timeline events={events} />);
```

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `events` | `TimelineEvent[]` | required | Array of events to display |
| `maxVisible` | `number` | `undefined` | Limit visible events with scroll indicators |
| `showRelativeTime` | `boolean` | `false` | Show "2m ago" style timestamps |

### TimelineEvent

| Field | Type | Description |
|-------|------|-------------|
| `time` | `string \| Date` | Displayed timestamp |
| `type` | `string` | Badge label (e.g. deploy, restart, alert) |
| `typeColor` | `string` | Override badge colour |
| `title` | `string` | Event title |
| `description` | `string` | Detail shown below title |

### Auto-colours

| Type | Colour |
|------|--------|
| deploy | green |
| restart | yellow |
| alert | red |
| error | red |
| info | blue |

## License

MIT
