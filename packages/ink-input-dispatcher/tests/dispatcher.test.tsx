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
});
