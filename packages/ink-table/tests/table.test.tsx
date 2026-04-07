import React from 'react';
import { render } from 'ink-testing-library';
import { describe, it, expect } from 'vitest';

import { Table, type Column } from '../src/table.js';

interface Person {
  name: string;
  age: number;
  city: string;
}

const sampleData: Person[] = [
  { name: 'Alice', age: 30, city: 'London' },
  { name: 'Bob', age: 25, city: 'Paris' },
  { name: 'Charlie', age: 35, city: 'Berlin' },
];

const columns: Column<Person>[] = [
  { key: 'name', header: 'Name' },
  { key: 'age', header: 'Age' },
  { key: 'city', header: 'City' },
];

describe('Table', () => {
  it('renders header and data rows', () => {
    const { lastFrame } = render(<Table data={sampleData} columns={columns} />);
    const output = lastFrame()!;
    expect(output).toContain('Name');
    expect(output).toContain('Age');
    expect(output).toContain('City');
    expect(output).toContain('Alice');
    expect(output).toContain('Bob');
    expect(output).toContain('Charlie');
    expect(output).toContain('London');
  });

  it('auto-calculates column widths', () => {
    const { lastFrame } = render(<Table data={sampleData} columns={columns} />);
    const output = lastFrame()!;
    expect(output).toContain('Name   ');
    expect(output).toContain('Alice  ');
    expect(output).toContain('Charlie');
  });

  it('truncates long cell values', () => {
    const longData = [
      { name: 'This is a very long name that exceeds the column width', age: 30, city: 'London' },
    ];
    const narrowColumns: Column<(typeof longData)[0]>[] = [
      { key: 'name', header: 'Name', width: 10 },
      { key: 'age', header: 'Age' },
      { key: 'city', header: 'City' },
    ];
    const { lastFrame } = render(<Table data={longData} columns={narrowColumns} />);
    const output = lastFrame()!;
    expect(output).toContain('This is a\u2026');
    expect(output).not.toContain('exceeds');
  });

  it('highlights selected row', () => {
    const { lastFrame } = render(
      <Table data={sampleData} columns={columns} selectedIndex={1} />,
    );
    const output = lastFrame()!;
    expect(output).toContain('Bob');
    expect(output).toContain('Paris');
  });

  it('windows data when maxVisible is set', () => {
    const manyItems = Array.from({ length: 20 }, (_, i) => ({
      name: `Person ${i}`,
      age: 20 + i,
      city: `City ${i}`,
    }));
    const cols: Column<(typeof manyItems)[0]>[] = [
      { key: 'name', header: 'Name' },
      { key: 'age', header: 'Age' },
      { key: 'city', header: 'City' },
    ];

    const { lastFrame } = render(
      <Table data={manyItems} columns={cols} maxVisible={5} selectedIndex={0} />,
    );
    const output = lastFrame()!;

    expect(output).toContain('Person 0');
    expect(output).toContain('Person 4');
    expect(output).not.toContain('Person 5');
    expect(output).toContain('more below');
    expect(output).not.toContain('more above');
  });

  it('shows empty text when no data', () => {
    const { lastFrame } = render(
      <Table data={[]} columns={columns} emptyText="Nothing here" />,
    );
    const output = lastFrame()!;
    expect(output).toContain('Nothing here');
    expect(output).not.toContain('Name');
  });

  it('right-aligns numeric columns', () => {
    const alignedColumns: Column<Person>[] = [
      { key: 'name', header: 'Name' },
      { key: 'age', header: 'Age', align: 'right', width: 6 },
      { key: 'city', header: 'City' },
    ];
    const { lastFrame } = render(<Table data={sampleData} columns={alignedColumns} />);
    const output = lastFrame()!;
    expect(output).toContain('    30');
    expect(output).toContain('    25');
    expect(output).toContain('   Age');
  });
});
