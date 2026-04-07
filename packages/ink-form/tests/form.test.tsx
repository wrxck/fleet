import React from 'react';
import { render } from 'ink-testing-library';
import { describe, it, expect, vi } from 'vitest';

import { Form } from '../src/form.js';
import type { FormField } from '../src/form.js';

describe('ink-form', () => {
  const baseFields: FormField[] = [
    { name: 'username', label: 'Username', type: 'text', required: true },
    { name: 'password', label: 'Password', type: 'password' },
    { name: 'role', label: 'Role', type: 'select', options: [
      { label: 'Admin', value: 'admin' },
      { label: 'User', value: 'user' },
    ]},
    { name: 'active', label: 'Active', type: 'boolean', defaultValue: true },
  ];

  it('renders fields with labels', () => {
    const { lastFrame } = render(
      <Form fields={baseFields} onSubmit={vi.fn()} />
    );
    const frame = lastFrame()!;
    expect(frame).toContain('Username');
    expect(frame).toContain('Password');
    expect(frame).toContain('Role');
    expect(frame).toContain('Active');
    expect(frame).toContain('Submit');
  });

  it('shows active field highlighted', () => {
    const { lastFrame } = render(
      <Form fields={baseFields} onSubmit={vi.fn()} />
    );
    const frame = lastFrame()!;
    expect(frame).toContain('> ');
    expect(frame).toContain('Username');
  });

  it('renders boolean toggle', () => {
    const { lastFrame } = render(
      <Form fields={baseFields} onSubmit={vi.fn()} />
    );
    const frame = lastFrame()!;
    expect(frame).toContain('[x]');
  });

  it('renders select field', () => {
    const { lastFrame } = render(
      <Form fields={baseFields} onSubmit={vi.fn()} />
    );
    const frame = lastFrame()!;
    expect(frame).toContain('Role');
  });

  it('renders custom submit label', () => {
    const { lastFrame } = render(
      <Form fields={baseFields} onSubmit={vi.fn()} submitLabel="Save" />
    );
    const frame = lastFrame()!;
    expect(frame).toContain('Save');
  });

  it('shows required indicator', () => {
    const { lastFrame } = render(
      <Form fields={baseFields} onSubmit={vi.fn()} />
    );
    const frame = lastFrame()!;
    expect(frame).toContain('*');
  });
});
