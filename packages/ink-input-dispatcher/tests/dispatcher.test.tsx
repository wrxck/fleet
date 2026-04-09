import React, { useState } from 'react';
import { render } from 'ink-testing-library';
import { Text } from 'ink';
import { describe, it, expect } from 'vitest';

import { InputDispatcher, useRegisterHandler } from '../src/dispatcher.js';
import type { InputHandler } from '../src/types.js';

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function TestView({ handler }: { handler: InputHandler }): React.JSX.Element {
  useRegisterHandler(handler);
  return <Text>view</Text>;
}

function StatefulTestView(): React.JSX.Element {
  const [lastKey, setLastKey] = useState('none');

  const handler: InputHandler = (input) => {
    setLastKey(input);
    return true;
  };

  useRegisterHandler(handler);
  return <Text>key:{lastKey}</Text>;
}

describe('InputDispatcher', () => {
  it('routes input to registered view handler', async () => {
    const { stdin, lastFrame } = render(
      <InputDispatcher>
        <StatefulTestView />
      </InputDispatcher>
    );

    expect(lastFrame()).toContain('key:none');
    await delay(100);
    stdin.write('j');
    await delay(50);
    expect(lastFrame()).toContain('key:j');
  });

  it('calls global handler first, skips view if consumed', async () => {
    const globalHandler: InputHandler = (input) => {
      if (input === 'q') return true;
      return false;
    };

    const { stdin, lastFrame } = render(
      <InputDispatcher globalHandler={globalHandler}>
        <StatefulTestView />
      </InputDispatcher>
    );

    await delay(100);
    stdin.write('q');
    await delay(50);
    // view handler should not have been called — still 'none'
    expect(lastFrame()).toContain('key:none');
  });

  it('falls through to view handler when global does not consume', async () => {
    const globalHandler: InputHandler = () => false;

    const { stdin, lastFrame } = render(
      <InputDispatcher globalHandler={globalHandler}>
        <StatefulTestView />
      </InputDispatcher>
    );

    await delay(100);
    stdin.write('j');
    await delay(50);
    expect(lastFrame()).toContain('key:j');
  });

  it('cleans up handler on unmount so it is not called', async () => {
    let called = false;
    const handler: InputHandler = () => {
      called = true;
      return true;
    };

    const { stdin, rerender } = render(
      <InputDispatcher>
        <TestView handler={handler} />
      </InputDispatcher>
    );

    await delay(100);
    stdin.write('a');
    await delay(50);
    expect(called).toBeTruthy();

    // unmount TestView by rerendering without it
    called = false;
    rerender(
      <InputDispatcher>
        <Text>gone</Text>
      </InputDispatcher>
    );
    await delay(100);

    stdin.write('z');
    await delay(100);
    expect(called).toBeFalsy();
  });

  it('passes tab key to global handler', async () => {
    let receivedTab = false;
    const globalHandler: InputHandler = (_input, key) => {
      if (key.tab) {
        receivedTab = true;
        return true;
      }
      return false;
    };

    const { stdin } = render(
      <InputDispatcher globalHandler={globalHandler}>
        <Text>app</Text>
      </InputDispatcher>
    );

    await delay(100);
    stdin.write('\t');
    await delay(50);
    expect(receivedTab).toBeTruthy();
  });

  it('passes arrow keys to view handler', async () => {
    const received: string[] = [];

    function ArrowView(): React.JSX.Element {
      const handler: InputHandler = (_input, key) => {
        if (key.upArrow) { received.push('up'); return true; }
        if (key.downArrow) { received.push('down'); return true; }
        return false;
      };
      useRegisterHandler(handler);
      return <Text>arrows</Text>;
    }

    const { stdin } = render(
      <InputDispatcher>
        <ArrowView />
      </InputDispatcher>
    );

    await delay(100);
    stdin.write('\x1B[A'); // up arrow
    await delay(50);
    stdin.write('\x1B[B'); // down arrow
    await delay(50);
    expect(received).toEqual(['up', 'down']);
  });

  it('passes escape key to global handler', async () => {
    let receivedEscape = false;
    const globalHandler: InputHandler = (_input, key) => {
      if (key.escape) {
        receivedEscape = true;
        return true;
      }
      return false;
    };

    const { stdin } = render(
      <InputDispatcher globalHandler={globalHandler}>
        <Text>app</Text>
      </InputDispatcher>
    );

    await delay(100);
    stdin.write('\x1B');
    await delay(50);
    expect(receivedEscape).toBeTruthy();
  });

  it('passes return key to view handler', async () => {
    let receivedReturn = false;

    function ReturnView(): React.JSX.Element {
      const handler: InputHandler = (_input, key) => {
        if (key.return) { receivedReturn = true; return true; }
        return false;
      };
      useRegisterHandler(handler);
      return <Text>enter</Text>;
    }

    const { stdin } = render(
      <InputDispatcher>
        <ReturnView />
      </InputDispatcher>
    );

    await delay(100);
    stdin.write('\r');
    await delay(50);
    expect(receivedReturn).toBeTruthy();
  });

  it('global handler consuming tab prevents view handler from seeing it', async () => {
    let viewSawTab = false;
    const globalHandler: InputHandler = (_input, key) => {
      if (key.tab) return true;
      return false;
    };

    function TabView(): React.JSX.Element {
      const handler: InputHandler = (_input, key) => {
        if (key.tab) { viewSawTab = true; return true; }
        return false;
      };
      useRegisterHandler(handler);
      return <Text>tabs</Text>;
    }

    const { stdin } = render(
      <InputDispatcher globalHandler={globalHandler}>
        <TabView />
      </InputDispatcher>
    );

    await delay(100);
    stdin.write('\t');
    await delay(50);
    expect(viewSawTab).toBeFalsy();
  });

  it('arrow keys fall through to view when global does not consume', async () => {
    const globalHandler: InputHandler = () => false;
    const received: string[] = [];

    function ArrowView(): React.JSX.Element {
      const handler: InputHandler = (_input, key) => {
        if (key.upArrow) { received.push('up'); return true; }
        if (key.downArrow) { received.push('down'); return true; }
        return false;
      };
      useRegisterHandler(handler);
      return <Text>arrows</Text>;
    }

    const { stdin } = render(
      <InputDispatcher globalHandler={globalHandler}>
        <ArrowView />
      </InputDispatcher>
    );

    await delay(100);
    stdin.write('\x1B[A');
    await delay(50);
    stdin.write('\x1B[B');
    await delay(50);
    expect(received).toEqual(['up', 'down']);
  });
});
