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

  it('renders without border chars when borderStyle is none', () => {
    const { lastFrame } = render(
      <Table data={sampleData} columns={columns} borderStyle="none" />,
    );
    const output = lastFrame()!;
    expect(output).not.toContain('\u2502');
    expect(output).not.toContain('\u2500');
    expect(output).toContain('Alice');
  });

  it('uses custom render function on column', () => {
    const customColumns: Column<Person>[] = [
      {
        key: 'name',
        header: 'Name',
        render: (value) => `[${String(value)}]`,
      },
      { key: 'age', header: 'Age' },
      { key: 'city', header: 'City' },
    ];
    const { lastFrame } = render(<Table data={sampleData} columns={customColumns} />);
    const output = lastFrame()!;
    expect(output).toContain('[Alice]');
    expect(output).toContain('[Bob]');
  });

  it('center-aligns column content', () => {
    const centerColumns: Column<Person>[] = [
      { key: 'name', header: 'Name', align: 'center', width: 11 },
      { key: 'age', header: 'Age' },
      { key: 'city', header: 'City' },
    ];
    const { lastFrame } = render(<Table data={sampleData} columns={centerColumns} />);
    const output = lastFrame()!;
    // 'Bob' (3 chars) in width 11 => 4 left + 'Bob' + 4 right
    expect(output).toContain('    Bob    ');
  });

  it('renders null and undefined cell values as empty', () => {
    interface Partial {
      name: string;
      note: string | undefined;
    }
    const data: Partial[] = [
      { name: 'Alice', note: undefined },
      { name: 'Bob', note: undefined },
    ];
    const cols: Column<Partial>[] = [
      { key: 'name', header: 'Name' },
      { key: 'note', header: 'Note', width: 6 },
    ];
    const { lastFrame } = render(<Table data={data} columns={cols} />);
    const output = lastFrame()!;
    expect(output).toContain('Alice');
    expect(output).toContain('Name');
    expect(output).toContain('Note');
  });
});
