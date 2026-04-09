# @matthesketh/ink-modal

An overlay dialog component for [Ink 5](https://github.com/vadimdemedes/ink). Since Ink's Yoga layout doesn't support true z-index, this renders a bordered box that visually appears as an overlay by being placed in the component tree above other content.

## Install

```sh
npm install @matthesketh/ink-modal
```

## Usage

```tsx
import React from 'react';
import { render, Text } from 'ink';
import { Modal } from '@matthesketh/ink-modal';

function App() {
  const [open, setOpen] = React.useState(true);

  return (
    <>
      <Text>Background content</Text>
      <Modal
        visible={open}
        title="Confirm Action"
        footer="[Enter] Confirm  [Esc] Cancel"
      >
        <Text>Are you sure you want to proceed?</Text>
      </Modal>
    </>
  );
}

render(<App />);
```

## Props

| Prop          | Type              | Default   | Description                          |
| ------------- | ----------------- | --------- | ------------------------------------ |
| `visible`     | `boolean`         | -         | Whether the modal is shown           |
| `title`       | `string`          | -         | Bold title at the top of the modal   |
| `width`       | `number`          | `50`      | Fixed width of the modal box         |
| `borderColor` | `string`          | `'cyan'`  | Color of the rounded border          |
| `children`    | `React.ReactNode` | -         | Body content                         |
| `footer`      | `React.ReactNode` | -         | Dimmed footer text at the bottom     |

## License

MIT
