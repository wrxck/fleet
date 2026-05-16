import type { SignalProvider } from '../types';

import { ciStatusProvider } from './ci-status';
import { createContainerUpProvider } from './container-up';
import { gitCleanProvider } from './git-clean';

export { ciStatusProvider, createContainerUpProvider, gitCleanProvider };

export function builtInSignalProviders(): SignalProvider[] {
  return [gitCleanProvider, createContainerUpProvider(), ciStatusProvider];
}
