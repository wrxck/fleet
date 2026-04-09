# @matthesketh/ink-tabs

A tab bar component for [Ink 5](https://github.com/vadimdemedes/ink). Shows labelled tabs with an active indicator, optional badges, and keyboard navigation support via parent `onChange`.

## Install

```bash
npm install @matthesketh/ink-tabs
```

## Usage

```tsx
import { Tabs } from '@matthesketh/ink-tabs';

const tabs = [
  { id: 'home', label: 'Home' },
  { id: 'logs', label: 'Logs', badge: 3 },
  { id: 'settings', label: 'Settings' },
];

function App() {
  const [activeId, setActiveId] = useState('home');

  return <Tabs tabs={tabs} activeId={activeId} onChange={setActiveId} />;
}
```

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `tabs` | `Tab[]` | required | Array of tab objects |
| `activeId` | `string` | required | ID of the currently active tab |
| `onChange` | `(id: string) => void` | — | Called when a tab should change (parent handles input) |
| `accentColor` | `string` | `'cyan'` | Colour for the active tab |
| `separator` | `string` | `' \| '` | String rendered between tabs |

### Tab

| Field | Type | Description |
|-------|------|-------------|
| `id` | `string` | Unique identifier |
| `label` | `string` | Display text |
| `badge` | `string \| number` | Optional badge shown as `(N)` after label |

## License

MIT
