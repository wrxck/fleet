import React from 'react';
import { render } from 'ink-testing-library';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { z } from 'zod';
import { InputDispatcher } from '@matthesketh/ink-input-dispatcher';

vi.mock('../exec-bridge', () => ({
  runFleetCommand: vi.fn(async () => ({ ok: true, output: 'done' })),
}));

import { runFleetCommand } from '../exec-bridge';
import { register, defineCommand } from '../../registry/registry';
import { loadRegistry, _resetLoader } from '../../registry/index';
import { CommandPalette } from './CommandPalette';

/** flush ink's render queue after a keystroke */
const flush = () => new Promise<void>(r => setTimeout(r, 30));

beforeEach(() => _resetLoader());
afterEach(() => _resetLoader());

describe('CommandPalette', () => {
  it('lists registry commands', async () => {
    const { lastFrame } = render(
      <InputDispatcher globalHandler={() => false}>
        <CommandPalette onOpenView={() => {}} onClose={() => {}} />
      </InputDispatcher>,
    );
    await flush();
    expect(lastFrame() ?? '').toContain('status');
  });

  it('hides non-matching commands when a query is typed', async () => {
    const { lastFrame, stdin } = render(
      <InputDispatcher globalHandler={() => false}>
        <CommandPalette onOpenView={() => {}} onClose={() => {}} />
      </InputDispatcher>,
    );
    await flush();
    // sanity: status is visible before filtering
    expect(lastFrame() ?? '').toContain('status');

    // type a query that matches nothing
    stdin.write('z');
    await flush();
    stdin.write('z');
    await flush();
    stdin.write('z');
    await flush();
    stdin.write('z');
    await flush();

    const frame = lastFrame() ?? '';
    expect(frame).not.toContain('status');
    expect(frame).toContain('no matching commands');
  });

  it('calls onOpenView when enter is pressed on a command with a tui view', async () => {
    // type 'stat' to filter to only status, then press enter.
    const onOpenView = vi.fn();

    const { stdin } = render(
      <InputDispatcher globalHandler={() => false}>
        <CommandPalette onOpenView={onOpenView} onClose={() => {}} />
      </InputDispatcher>,
    );
    await flush();

    stdin.write('s');
    await flush();
    stdin.write('t');
    await flush();
    stdin.write('a');
    await flush();
    stdin.write('t');
    await flush();

    stdin.write('\r');
    await flush();

    expect(onOpenView).toHaveBeenCalledWith('dashboard');
  });

  it('builds argv from an empty-args command and calls runFleetCommand', async () => {
    // register an ad-hoc command with no tui and an empty args schema.
    // loadRegistry() first so the loaded flag is set and the component's own
    // call does not wipe the ad-hoc registration.
    loadRegistry();
    register(defineCommand({
      name: 'demo-run',
      summary: 'a demo command',
      args: z.object({}),
      async run() { return { ok: true, summary: 'ok', data: null }; },
    }));

    const { stdin } = render(
      <InputDispatcher globalHandler={() => false}>
        <CommandPalette onOpenView={() => {}} onClose={() => {}} />
      </InputDispatcher>,
    );
    await flush();

    // allCommands() sorts by name: 'demo-run' (index 0) before 'status' (index 1).
    // press enter on demo-run → ArgForm shown (no tui field).
    stdin.write('\r');
    await flush();

    // ArgForm with no fields: press enter → onSubmit({}) → runFleetCommand.
    stdin.write('\r');
    await flush();

    expect(vi.mocked(runFleetCommand)).toHaveBeenCalledWith(['demo-run']);
  });

  it('builds --flag argv when a boolean field is toggled before submit', async () => {
    // register a command with a boolean arg.
    loadRegistry();
    register(defineCommand({
      name: 'demo-flag',
      summary: 'a flag demo',
      args: z.object({ force: z.boolean().default(false) }),
      async run() { return { ok: true, summary: 'ok', data: null }; },
    }));

    const { stdin } = render(
      <InputDispatcher globalHandler={() => false}>
        <CommandPalette onOpenView={() => {}} onClose={() => {}} />
      </InputDispatcher>,
    );
    await flush();

    // sorted order: demo-flag (0), status (1). press enter on demo-flag.
    stdin.write('\r');
    await flush();

    // ArgForm is now showing the 'force' boolean field (cursor on it).
    // press space to toggle force → true.
    stdin.write(' ');
    await flush();

    // press enter to submit { force: true }.
    stdin.write('\r');
    await flush();

    expect(vi.mocked(runFleetCommand)).toHaveBeenCalledWith(['demo-flag', '--force']);
  });
});
