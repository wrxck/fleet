import React from 'react';
import { render } from 'ink';
import { App } from './router';

export function launchTui(): void {
  const { waitUntilExit } = render(<App />);
  waitUntilExit().then(() => {
    process.exit(0);
  });
}
