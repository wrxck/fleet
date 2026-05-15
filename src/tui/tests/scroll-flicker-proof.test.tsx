import React, { useReducer } from 'react';
import { EventEmitter } from 'node:events';
import { describe, it, expect, beforeEach, vi } from 'vitest';

// Force Ink's real (non-CI) render path so the flicker branch is reachable.
// ink-testing-library renders in debug mode, where Ink's onRender returns
// before the clear-screen branch — so it cannot observe the flicker at all.
// This proof drives Ink's genuine production render() instead.
vi.mock('is-in-ci', () => ({ default: false }));

// eslint-disable-next-line import/first
import { render, Box, Text } from 'ink';
// eslint-disable-next-line import/first
import { Viewport, useAvailableHeight } from '@matthesketh/ink-viewport';
// eslint-disable-next-line import/first
import { ScrollableList } from '@matthesketh/ink-scrollable-list';
// eslint-disable-next-line import/first
import { InputDispatcher, useRegisterHandler } from '@matthesketh/ink-input-dispatcher';
// eslint-disable-next-line import/first
import type { InputHandler } from '@matthesketh/ink-input-dispatcher';

// ESC (0x1B) built without a control-char literal in source.
const ESC = String.fromCharCode(27);
// Ink writes this exact sequence (ansiEscapes.clearTerminal) before a frame
// whenever the frame height is >= stdout.rows — a full-screen wipe on every
// re-render. That wipe IS the flicker; counting it proves its presence.
const CLEAR_TERMINAL = `${ESC}[2J${ESC}[3J${ESC}[H`;
const DOWN_ARROW = `${ESC}[B`;
const ROWS = 24;
const COLUMNS = 120;
const SCROLL_STEPS = 20;
const APPS = Array.from({ length: 200 }, (_, i) => `app-${i}`);

/** A stdout that records every byte Ink writes and reports a fixed size. */
class RecordingStdout extends EventEmitter {
  columns = COLUMNS;
  rows = ROWS;
  isTTY = true;
  writes: string[] = [];
  write = (data: string): boolean => {
    this.writes.push(data);
    return true;
  };
}

/** A TTY-like stdin mirroring ink-testing-library's: a keypress is delivered
 *  via both the 'readable'/read() and 'data' paths. */
class FakeStdin extends EventEmitter {
  isTTY = true;
  data: string | null = null;
  press = (data: string): void => {
    this.data = data;
    this.emit('readable');
    this.emit('data', data);
  };
  setEncoding(): void {}
  setRawMode(): void {}
  resume(): void {}
  pause(): void {}
  ref(): void {}
  unref(): void {}
  read = (): string | null => {
    const d = this.data;
    this.data = null;
    return d;
  };
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Mirrors Fleet's Dashboard: a windowed ScrollableList sized off
 *  useAvailableHeight(), driven by j / down-arrow via the input dispatcher. */
function MockDashboard(): React.JSX.Element {
  const [index, move] = useReducer(
    (cur: number, delta: number) =>
      Math.max(0, Math.min(APPS.length - 1, cur + delta)),
    0,
  );
  const available = useAvailableHeight();
  const listHeight = Math.max(5, available - 4); // same formula as Dashboard.tsx

  const handler: InputHandler = (input, key) => {
    if (input === 'j' || key.downArrow) {
      move(1);
      return true;
    }
    if (input === 'k' || key.upArrow) {
      move(-1);
      return true;
    }
    return false;
  };
  useRegisterHandler(handler);

  return (
    <Box flexDirection="column" padding={1}>
      <Text bold>{APPS.length} apps</Text>
      <ScrollableList
        items={APPS}
        selectedIndex={index}
        maxVisible={listHeight}
        renderItem={(item: string, selected: boolean) => (
          <Text color={selected ? 'cyan' : undefined}>
            {selected ? '> ' : '  '}
            {item}
          </Text>
        )}
      />
    </Box>
  );
}

/** Fleet's real chrome: InputDispatcher outside, Viewport(chrome) inside. */
function FleetUI(): React.JSX.Element {
  return (
    <InputDispatcher globalHandler={() => false}>
      <Viewport chrome={6}>
        <Text>fleet</Text>
        <MockDashboard />
      </Viewport>
    </InputDispatcher>
  );
}

/** The pre-fix viewport: a root box pinned to the FULL terminal height. */
function LegacyChrome(): React.JSX.Element {
  return (
    <InputDispatcher globalHandler={() => false}>
      <Box flexDirection="column" height={ROWS}>
        <Text>fleet</Text>
        <MockDashboard />
      </Box>
    </InputDispatcher>
  );
}

interface ScrollResult {
  clears: number;
  output: string;
}

/** Mount with Ink's production render path, scroll SCROLL_STEPS rows, and
 *  record every byte Ink writes to the terminal. */
async function scrollAndRecord(node: React.JSX.Element): Promise<ScrollResult> {
  const stdout = new RecordingStdout();
  const stdin = new FakeStdin();
  const app = render(node, {
    stdout: stdout as unknown as NodeJS.WriteStream,
    stdin: stdin as unknown as NodeJS.ReadStream,
    debug: false,
    exitOnCtrlC: false,
    patchConsole: false,
  });

  await sleep(40);
  for (let i = 0; i < SCROLL_STEPS; i++) {
    stdin.press(DOWN_ARROW);
    await sleep(45); // > Ink's 32ms render throttle, so each scroll renders
  }
  await sleep(60);
  app.unmount();

  const output = stdout.writes.join('');
  return { clears: output.split(CLEAR_TERMINAL).length - 1, output };
}

describe('Fleet TUI scroll flicker proof', () => {
  beforeEach(() => {
    process.setMaxListeners(0);
    Object.defineProperty(process.stdout, 'rows', {
      value: ROWS,
      writable: true,
      configurable: true,
    });
    Object.defineProperty(process.stdout, 'columns', {
      value: COLUMNS,
      writable: true,
      configurable: true,
    });
  });

  it('CONTROL: a full-terminal-height frame flickers on every scroll render', async () => {
    // Reproduces the pre-fix layout (box height = rows). Proves both that the
    // bug was real and that the recorder genuinely detects clearTerminal —
    // without this anchor, the "0 clears" assertion below would be hollow.
    const { clears } = await scrollAndRecord(<LegacyChrome />);
    expect(clears).toBeGreaterThan(0);
  });

  it('Fleet UI scrolls 20 rows with ZERO full-screen clears', async () => {
    const { clears, output } = await scrollAndRecord(<FleetUI />);

    // The scroll genuinely happened: ScrollableList only renders its
    // "more above" indicator once the window has scrolled down.
    expect(output).toContain('more above');

    // ...and across every one of those re-renders, Ink never wiped the
    // screen. Zero clearTerminal sequences => zero flicker.
    expect(clears).toBe(0);
  });
});
