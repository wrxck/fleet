import React from 'react';
import { render } from 'ink-testing-library';
import { describe, it, expect } from 'vitest';

import { TaskList } from '../src/task-list.js';
import type { Task } from '../src/task-list.js';

describe('ink-task-list', () => {
  it('renders pending tasks', () => {
    const tasks: Task[] = [
      { label: 'Install dependencies', status: 'pending' },
      { label: 'Build project', status: 'pending' },
    ];

    const { lastFrame } = render(<TaskList tasks={tasks} />);
    const frame = lastFrame()!;

    expect(frame).toContain('\u25CB');
    expect(frame).toContain('Install dependencies');
    expect(frame).toContain('Build project');
  });

  it('renders success and error indicators', () => {
    const tasks: Task[] = [
      { label: 'Passed step', status: 'success' },
      { label: 'Failed step', status: 'error' },
      { label: 'Skipped step', status: 'skipped' },
    ];

    const { lastFrame } = render(<TaskList tasks={tasks} />);
    const frame = lastFrame()!;

    expect(frame).toContain('\u2713');
    expect(frame).toContain('Passed step');
    expect(frame).toContain('\u2717');
    expect(frame).toContain('Failed step');
    expect(frame).toContain('\u2013');
    expect(frame).toContain('Skipped step');
  });

  it('renders running state with spinner', () => {
    const tasks: Task[] = [
      { label: 'Running task', status: 'running' },
    ];

    const { lastFrame } = render(<TaskList tasks={tasks} />);
    const frame = lastFrame()!;

    // the spinner renders an animated character; the label should be present
    expect(frame).toContain('Running task');
  });

  it('shows task output when present', () => {
    const tasks: Task[] = [
      { label: 'Compile', status: 'success', output: 'Compiled 42 files' },
      { label: 'Lint', status: 'error', output: 'Found 3 errors' },
    ];

    const { lastFrame } = render(<TaskList tasks={tasks} />);
    const frame = lastFrame()!;

    expect(frame).toContain('Compiled 42 files');
    expect(frame).toContain('Found 3 errors');
  });

  it('hides task output when showOutput is false', () => {
    const tasks: Task[] = [
      { label: 'Compile', status: 'success', output: 'Compiled 42 files' },
    ];

    const { lastFrame } = render(<TaskList tasks={tasks} showOutput={false} />);
    const frame = lastFrame()!;

    expect(frame).toContain('Compile');
    expect(frame).not.toContain('Compiled 42 files');
  });

  it('renders empty tasks array without crash', () => {
    const tasks: Task[] = [];
    const { lastFrame } = render(<TaskList tasks={tasks} />);
    const frame = lastFrame()!;
    expect(frame).toBeDefined();
  });
});
