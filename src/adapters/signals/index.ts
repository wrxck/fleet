import type { SignalProvider } from '../types.js';

import { ciStatusProvider } from './ci-status.js';
import { createContainerUpProvider } from './container-up.js';
import { gitCleanProvider } from './git-clean.js';

export { ciStatusProvider, createContainerUpProvider, gitCleanProvider };

export function builtInSignalProviders(): SignalProvider[] {
  return [gitCleanProvider, createContainerUpProvider(), ciStatusProvider];
}
