import React from 'react';
import { render } from 'ink-testing-library';
import { Text } from 'ink';
import { describe, it, expect, beforeEach } from 'vitest';

import { Viewport } from '../src/viewport.js';
import { useAvailableHeight } from '../src/context.js';

function HeightDisplay(): React.JSX.Element {
  const height = useAvailableHeight();
  return <Text>height:{height}</Text>;
}

describe('Viewport', () => {
  beforeEach(() => {
    Object.defineProperty(process.stdout, 'rows', { value: 40, writable: true, configurable: true });
  });

  it('provides available height minus chrome', () => {
    const { lastFrame } = render(
      <Viewport chrome={6}>
        <HeightDisplay />
      </Viewport>
    );
    expect(lastFrame()).toContain('height:34');
  });
});
