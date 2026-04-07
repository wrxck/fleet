import React from 'react';
import { render } from 'ink-testing-library';
import { describe, it, expect } from 'vitest';

import { Pipeline } from '../src/pipeline.js';
import type { PipelineStep } from '../src/pipeline.js';

describe('ink-pipeline', () => {
  it('renders steps with correct indicators', () => {
    const steps: PipelineStep[] = [
      { label: 'Install', status: 'success' },
      { label: 'Build', status: 'running' },
      { label: 'Deploy', status: 'pending' },
      { label: 'Cleanup', status: 'skipped' },
      { label: 'Notify', status: 'error' },
    ];

    const { lastFrame } = render(<Pipeline steps={steps} />);
    const frame = lastFrame()!;

    expect(frame).toContain('\u2713');
    expect(frame).toContain('Install');
    expect(frame).toContain('Build');
    expect(frame).toContain('\u25CB');
    expect(frame).toContain('Deploy');
    expect(frame).toContain('\u2013');
    expect(frame).toContain('Cleanup');
    expect(frame).toContain('\u2717');
    expect(frame).toContain('Notify');
  });

  it('shows progress bar when running with progress', () => {
    const steps: PipelineStep[] = [
      { label: 'Uploading', status: 'running', progress: 0.45 },
    ];

    const { lastFrame } = render(<Pipeline steps={steps} />);
    const frame = lastFrame()!;

    expect(frame).toContain('45%');
    expect(frame).toContain('[');
    expect(frame).toContain(']');
  });

  it('shows duration on completed steps', () => {
    const steps: PipelineStep[] = [
      { label: 'Build', status: 'success', duration: 1200 },
      { label: 'Test', status: 'success', duration: 350 },
    ];

    const { lastFrame } = render(<Pipeline steps={steps} />);
    const frame = lastFrame()!;

    expect(frame).toContain('(1.2s)');
    expect(frame).toContain('(350ms)');
  });

  it('shows rolling-back state', () => {
    const steps: PipelineStep[] = [
      { label: 'Deploy', status: 'rolling-back' },
    ];

    const { lastFrame } = render(<Pipeline steps={steps} />);
    const frame = lastFrame()!;

    expect(frame).toContain('\u21BA');
    expect(frame).toContain('Deploy');
  });

  it('renders title when provided', () => {
    const steps: PipelineStep[] = [
      { label: 'Step 1', status: 'pending' },
    ];

    const { lastFrame } = render(<Pipeline steps={steps} title="Deploy Pipeline" />);
    const frame = lastFrame()!;

    expect(frame).toContain('Deploy Pipeline');
  });

  it('shows connecting lines between steps in normal mode', () => {
    const steps: PipelineStep[] = [
      { label: 'First', status: 'success' },
      { label: 'Second', status: 'pending' },
    ];

    const { lastFrame } = render(<Pipeline steps={steps} />);
    const frame = lastFrame()!;

    expect(frame).toContain('\u2502');
  });

  it('hides connecting lines and output in compact mode', () => {
    const steps: PipelineStep[] = [
      { label: 'First', status: 'success', output: 'Some detail' },
      { label: 'Second', status: 'pending' },
    ];

    const { lastFrame } = render(<Pipeline steps={steps} compact />);
    const frame = lastFrame()!;

    expect(frame).not.toContain('\u2502');
    expect(frame).not.toContain('Some detail');
  });

  it('shows step output when present', () => {
    const steps: PipelineStep[] = [
      { label: 'Build', status: 'success', output: 'Compiled 42 files' },
    ];

    const { lastFrame } = render(<Pipeline steps={steps} />);
    const frame = lastFrame()!;

    expect(frame).toContain('Compiled 42 files');
  });

  it('hides progress when showProgress is false', () => {
    const steps: PipelineStep[] = [
      { label: 'Upload', status: 'running', progress: 0.5 },
    ];

    const { lastFrame } = render(<Pipeline steps={steps} showProgress={false} />);
    const frame = lastFrame()!;

    expect(frame).not.toContain('50%');
  });

  it('hides duration when showDuration is false', () => {
    const steps: PipelineStep[] = [
      { label: 'Build', status: 'success', duration: 1200 },
    ];

    const { lastFrame } = render(<Pipeline steps={steps} showDuration={false} />);
    const frame = lastFrame()!;

    expect(frame).not.toContain('1.2s');
  });

  it('renders with empty steps without crashing', () => {
    const { lastFrame } = render(<Pipeline steps={[]} />);
    const frame = lastFrame()!;
    expect(frame).toBeDefined();
  });

  it('shows 0% for progress=0', () => {
    const steps: PipelineStep[] = [
      { label: 'Upload', status: 'running', progress: 0 },
    ];

    const { lastFrame } = render(<Pipeline steps={steps} />);
    const frame = lastFrame()!;

    expect(frame).toContain('0%');
  });

  it('shows 100% for progress=1', () => {
    const steps: PipelineStep[] = [
      { label: 'Upload', status: 'running', progress: 1 },
    ];

    const { lastFrame } = render(<Pipeline steps={steps} />);
    const frame = lastFrame()!;

    expect(frame).toContain('100%');
  });
});
