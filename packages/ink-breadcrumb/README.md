# @matthesketh/ink-breadcrumb

A navigation trail/breadcrumb component for [Ink 5](https://github.com/vadimdemedes/ink). Shows the user's current position in a hierarchy.

## Install

```bash
npm install @matthesketh/ink-breadcrumb
```

## Usage

```tsx
import { Breadcrumb } from '@matthesketh/ink-breadcrumb';

<Breadcrumb path={['Dashboard', 'api-server', 'Logs']} />
```

Output: `Dashboard › api-server › **Logs**`

## Props

| Prop            | Type       | Default   | Description                        |
| --------------- | ---------- | --------- | ---------------------------------- |
| `path`          | `string[]` | required  | Breadcrumb segments                |
| `separator`     | `string`   | `' › '`   | Separator between segments         |
| `activeColor`   | `string`   | `'cyan'`  | Colour of the last (active) item   |
| `inactiveColor` | `string`   | `'gray'`  | Colour of parent items             |

## License

MIT
