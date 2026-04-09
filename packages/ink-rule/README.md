# @matthesketh/ink-rule

A horizontal divider/separator for [Ink 5](https://github.com/vadimdemedes/ink) with optional centred label.

## Install

```sh
npm install @matthesketh/ink-rule
```

## Usage

```tsx
import { Rule } from '@matthesketh/ink-rule';

// simple horizontal rule
<Rule />

// with a centred title
<Rule title="Section" />

// custom character and colour
<Rule char="=" color="cyan" />

// fixed width
<Rule width={40} title="Info" />
```

## Props

| Prop    | Type     | Default                    | Description                      |
| ------- | -------- | -------------------------- | -------------------------------- |
| `title` | `string` |                            | centred label in the rule        |
| `char`  | `string` | `'\u2500'`                 | character used to draw the line  |
| `color` | `string` | `'grey'`                   | colour of the line characters    |
| `width` | `number` | `process.stdout.columns`   | width of the rule in columns     |

## License

MIT
