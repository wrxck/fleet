import React from 'react';

import { render, Box, Text } from 'ink';
import { InputDispatcher } from '@matthesketh/ink-input-dispatcher';
import type { InputHandler } from '@matthesketh/ink-input-dispatcher';
import { Viewport } from '@matthesketh/ink-viewport';
import { ToastProvider, ToastContainer } from '@matthesketh/ink-toast';

import { load } from '../core/registry.js';
import { RoutinesApp } from '../tui/routines/RoutinesApp.js';
import { createRuntime, type RoutinesRuntime } from '../tui/routines/runtime.js';

function Shell({ runtime, registry }: { runtime: RoutinesRuntime; registry: ReturnType<typeof load> }): React.JSX.Element {
  const globalHandler: InputHandler = (input, _key) => {
    if (input === 'q') {
      runtime.close();
      process.exit(0);
    }
    return false;
  };

  return (
    <ToastProvider>
      <InputDispatcher globalHandler={globalHandler}>
        <Viewport chrome={2}>
          <Box flexDirection="column" flexGrow={1}>
            <Box paddingX={1} paddingY={0}>
              <Text bold color="cyan">fleet routines</Text>
              <Text color="gray">  ·  q to quit</Text>
            </Box>
            <RoutinesApp runtime={runtime} registry={registry} />
            <ToastContainer />
          </Box>
        </Viewport>
      </InputDispatcher>
    </ToastProvider>
  );
}

export async function routinesCommand(_args: string[]): Promise<void> {
  const runtime = createRuntime();
  const registry = load();
  const { waitUntilExit } = render(<Shell runtime={runtime} registry={registry} />);
  await waitUntilExit();
  runtime.close();
}
