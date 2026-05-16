import { describe, it, expect } from 'vitest';

import { makeMcpContext, makeCliContext } from './context';

describe('command context builders', () => {
  it('mcp context resolves confirm from the confirm flag', async () => {
    const granted = makeMcpContext(true);
    const denied = makeMcpContext(false);
    expect(await granted.confirm('go?')).toBe(true);
    expect(await denied.confirm('go?')).toBe(false);
  });

  it('cli context exposes process.env', () => {
    expect(makeCliContext().env).toBe(process.env);
  });

  it('mcp context log does not throw', () => {
    expect(() => makeMcpContext(true).log({ level: 'info', message: 'hi' })).not.toThrow();
  });
});
