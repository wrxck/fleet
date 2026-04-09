# @matthesketh/ink-form

A form builder for Ink 5 that composes text inputs, selects, checkboxes, and switches into a navigable form with validation.

## Install

```bash
npm install @matthesketh/ink-form
```

## Usage

```tsx
import { Form } from '@matthesketh/ink-form';

const fields = [
  { name: 'username', label: 'Username', type: 'text' as const, required: true },
  { name: 'password', label: 'Password', type: 'password' as const },
  { name: 'role', label: 'Role', type: 'select' as const, options: [
    { label: 'Admin', value: 'admin' },
    { label: 'User', value: 'user' },
  ]},
  { name: 'active', label: 'Active', type: 'boolean' as const, defaultValue: true },
];

function App() {
  return (
    <Form
      fields={fields}
      onSubmit={(values) => console.log(values)}
      onCancel={() => process.exit()}
    />
  );
}
```

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `fields` | `FormField[]` | required | Array of field definitions |
| `onSubmit` | `(values) => void` | required | Called with form values on submit |
| `onCancel` | `() => void` | - | Called when Escape is pressed |
| `submitLabel` | `string` | `'Submit'` | Label for the submit button |

## Field types

- **text** - inline text input
- **password** - masked input
- **select** - dropdown selection from options
- **boolean** - toggle switch

## Navigation

- Arrow keys / Tab to move between fields
- Enter to edit text fields or toggle booleans
- Enter on select fields opens a dropdown
- Enter on submit button submits the form
- Escape to cancel

## Licence

MIT
