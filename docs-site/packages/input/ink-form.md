# ink-form

Multi-field form with text, password, select, and boolean inputs for Ink terminal apps.

## Installation

```bash
npm install @matthesketh/ink-form
```

Peer dependencies: `ink` (>=5.0.0) and `react` (>=18.0.0).

## Usage

```tsx
import React from 'react';
import { render } from 'ink';
import { Form } from '@matthesketh/ink-form';
import type { FormField } from '@matthesketh/ink-form';

const fields: FormField[] = [
  { name: 'username', label: 'Username', type: 'text', required: true, placeholder: 'Enter username' },
  { name: 'password', label: 'Password', type: 'password', required: true },
  {
    name: 'role',
    label: 'Role',
    type: 'select',
    options: [
      { label: 'Admin', value: 'admin' },
      { label: 'User', value: 'user' },
      { label: 'Guest', value: 'guest' },
    ],
  },
  { name: 'agree', label: 'Accept terms', type: 'boolean', defaultValue: false },
];

function App() {
  return (
    <Form
      fields={fields}
      onSubmit={(values) => {
        console.log('Submitted:', values);
        process.exit(0);
      }}
      onCancel={() => process.exit(1)}
      submitLabel="Create Account"
    />
  );
}

render(<App />);
```

## Props

### `FormProps`

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `fields` | `FormField[]` | **required** | Array of field definitions to render. |
| `onSubmit` | `(values: Record<string, string \| boolean>) => void` | **required** | Called with all field values when the form is submitted and validation passes. |
| `onCancel` | `() => void` | `undefined` | Called when the user presses Escape while not editing a field or dropdown. |
| `submitLabel` | `string` | `'Submit'` | Label displayed on the submit button. |

### `FormField`

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `name` | `string` | **required** | Unique key used in the values record. |
| `label` | `string` | **required** | Displayed label for the field. |
| `type` | `FieldType` | **required** | One of `'text'`, `'password'`, `'select'`, or `'boolean'`. |
| `required` | `boolean` | `undefined` | If `true`, validation fails when the value is empty. Displays a `*` next to the label. |
| `defaultValue` | `string \| boolean` | `''` for text/password/select, `false` for boolean | Initial value for the field. |
| `options` | `{ label: string; value: string }[]` | `undefined` | Options for `select` type fields. |
| `placeholder` | `string` | `undefined` | Placeholder text shown when the field is empty and not being edited. |
| `validate` | `(value: string \| boolean) => string \| null` | `undefined` | Custom validation function. Return an error string to fail, or `null` to pass. |

### `FieldType`

```ts
type FieldType = 'text' | 'password' | 'select' | 'boolean';
```

## Examples

### With custom validation

```tsx
const fields: FormField[] = [
  {
    name: 'email',
    label: 'Email',
    type: 'text',
    required: true,
    validate: (value) => {
      if (typeof value === 'string' && !value.includes('@')) {
        return 'Must be a valid email address';
      }
      return null;
    },
  },
];
```

### Minimal two-field form

```tsx
<Form
  fields={[
    { name: 'host', label: 'Host', type: 'text', defaultValue: 'localhost' },
    { name: 'port', label: 'Port', type: 'text', defaultValue: '3000' },
  ]}
  onSubmit={(values) => console.log(values)}
/>
```

## Keyboard Controls

| Key | Action |
|-----|--------|
| Up / Shift+Tab | Move to previous field |
| Down / Tab | Move to next field |
| Enter | Start editing text/password, open select dropdown, toggle boolean, or submit when on the submit button |
| Space | Toggle boolean fields |
| Escape | Close dropdown, stop editing, or cancel the form |
| Backspace | Delete last character while editing text/password |

## Notes

- The form runs its own `useInput` hook internally. When composing with `@matthesketh/ink-input-dispatcher`, consider wrapping the form in a view that only mounts when the form is active.
- Password fields mask input with `*` characters.
- Validation runs on all fields when the submit button is pressed. Errors display in red below each field.
- The active field is highlighted in cyan.
