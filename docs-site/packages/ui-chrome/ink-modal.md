# ink-modal

A toggleable modal dialog with rounded border, optional title, and footer for Ink terminal apps.

## Installation

```bash
npm install @matthesketh/ink-modal
```

Peer dependencies: `ink` (>=5.0.0) and `react` (>=18.0.0).

## Usage

```tsx
import React, { useState } from 'react';
import { render, Box, Text } from 'ink';
import { Modal } from '@matthesketh/ink-modal';

function App() {
  const [showModal, setShowModal] = useState(true);

  return (
    <Box flexDirection="column">
      <Text>Background content here</Text>
      <Modal
        visible={showModal}
        title="Confirm Action"
        footer="Press Enter to confirm, Esc to cancel"
      >
        <Text>Are you sure you want to deploy to production?</Text>
        <Text>This will affect 3 running services.</Text>
      </Modal>
    </Box>
  );
}

render(<App />);
```

## Props

### `ModalProps`

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `visible` | `boolean` | **required** | Controls whether the modal is rendered. When `false`, the component returns `null`. |
| `title` | `string` | `undefined` | Optional title displayed at the top of the modal in bold. |
| `width` | `number` | `50` | Width of the modal box in columns. |
| `borderColor` | `string` | `'cyan'` | Ink color for the rounded border. |
| `children` | `React.ReactNode` | **required** | Content rendered inside the modal body. |
| `footer` | `React.ReactNode` | `undefined` | Optional footer content displayed below the body with dim styling. |

## Examples

### Error dialog

```tsx
<Modal visible={hasError} title="Error" borderColor="red" width={60}>
  <Text color="red">{errorMessage}</Text>
</Modal>
```

### Confirmation with custom footer

```tsx
<Modal
  visible={showConfirm}
  title="Delete App"
  borderColor="yellow"
  footer={
    <Text>
      <Text bold>[y]</Text> Yes  <Text bold>[n]</Text> No
    </Text>
  }
>
  <Text>This will permanently delete "my-api" and all its data.</Text>
</Modal>
```

### Narrow info modal

```tsx
<Modal visible={true} title="Tip" width={35} borderColor="green">
  <Text>Press Tab to switch views.</Text>
</Modal>
```

## Visual Output

The modal renders as a rounded-border box using Ink's `round` border style:

```
+--------------------------------------------------+
| Confirm Action                                   |
|                                                  |
| Are you sure you want to deploy to production?   |
| This will affect 3 running services.             |
|                                                  |
| Press Enter to confirm, Esc to cancel            |
+--------------------------------------------------+
```

In the terminal, the border uses rounded Unicode box-drawing characters.

## Notes

- The modal is centered horizontally using `alignItems="center"` on a full-width container.
- The border uses Ink's `round` border style.
- The title has a bottom margin of 1 line, and the footer has a top margin of 1 line, creating visual separation.
- The footer renders with dim styling (`dimColor`), making it suitable for hint text.
- When `visible` is `false`, the component returns `null` and takes up no space.
