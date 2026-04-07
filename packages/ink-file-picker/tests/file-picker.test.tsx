import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import React from 'react';
import { render } from 'ink-testing-library';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { FilePicker } from '../src/file-picker.js';

const delay = (ms: number) => new Promise(r => setTimeout(r, ms));

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ink-file-picker-test-'));

  fs.mkdirSync(path.join(tmpDir, 'alpha'));
  fs.mkdirSync(path.join(tmpDir, 'beta'));
  fs.writeFileSync(path.join(tmpDir, 'hello.ts'), 'console.log("hi")');
  fs.writeFileSync(path.join(tmpDir, 'world.tsx'), '<App />');
  fs.writeFileSync(path.join(tmpDir, 'readme.md'), '# Hello');
  fs.writeFileSync(path.join(tmpDir, '.hidden'), 'secret');
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('FilePicker', () => {
  it('renders directory listing with folders first', () => {
    const { lastFrame } = render(
      <FilePicker initialPath={tmpDir} onSelect={() => {}} />,
    );
    const frame = lastFrame()!;

    expect(frame).toContain(tmpDir);
    expect(frame).toContain('alpha');
    expect(frame).toContain('beta');
    expect(frame).toContain('hello.ts');
    expect(frame).toContain('world.tsx');
    expect(frame).toContain('readme.md');

    const alphaPos = frame.indexOf('alpha');
    const helloPos = frame.indexOf('hello.ts');
    expect(alphaPos).toBeLessThan(helloPos);
  });

  it('filters by extension', () => {
    const { lastFrame } = render(
      <FilePicker
        initialPath={tmpDir}
        extensions={['.ts', '.tsx']}
        onSelect={() => {}}
      />,
    );
    const frame = lastFrame()!;

    expect(frame).toContain('hello.ts');
    expect(frame).toContain('world.tsx');
    expect(frame).not.toContain('readme.md');

    expect(frame).toContain('alpha');
  });

  it('shows folders first sorted alphabetically', () => {
    const { lastFrame } = render(
      <FilePicker initialPath={tmpDir} onSelect={() => {}} />,
    );
    const frame = lastFrame()!;

    const alphaPos = frame.indexOf('alpha');
    const betaPos = frame.indexOf('beta');
    expect(alphaPos).toBeLessThan(betaPos);
  });

  it('hides hidden files by default', () => {
    const { lastFrame } = render(
      <FilePicker initialPath={tmpDir} onSelect={() => {}} />,
    );
    expect(lastFrame()!).not.toContain('.hidden');
  });

  it('shows hidden files when showHidden is true', () => {
    const { lastFrame } = render(
      <FilePicker initialPath={tmpDir} showHidden onSelect={() => {}} />,
    );
    expect(lastFrame()!).toContain('.hidden');
  });

  it('Enter on file calls onSelect', async () => {
    const onSelect = vi.fn();
    const { stdin } = render(
      <FilePicker initialPath={tmpDir} onSelect={onSelect} />,
    );
    await delay(100);
    // navigate past the two directories (alpha, beta) to the first file
    stdin.write('\x1b[B');
    await delay(50);
    stdin.write('\x1b[B');
    await delay(50);
    stdin.write('\r');
    await delay(50);
    expect(onSelect).toHaveBeenCalled();
    const selectedPath = onSelect.mock.calls[0]![0] as string;
    expect(selectedPath).toContain(tmpDir);
  });

  it('Escape calls onCancel', async () => {
    const onCancel = vi.fn();
    const { stdin } = render(
      <FilePicker initialPath={tmpDir} onSelect={() => {}} onCancel={onCancel} />,
    );
    await delay(100);
    stdin.write('\x1b');
    await delay(50);
    expect(onCancel).toHaveBeenCalled();
  });
});
