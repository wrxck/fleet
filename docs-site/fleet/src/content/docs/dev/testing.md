---
title: Testing
description: How to run and write tests for fleet
---

import { Aside, Tabs, TabItem } from '@astrojs/starlight/components';

Fleet uses [Vitest](https://vitest.dev/) for testing. The test suite covers core modules, commands, MCP tools, templates, and TUI state management.

## Running tests

```bash
# Run all tests
npm test

# Run a specific file
npx vitest run src/core/health.test.ts

# Run tests matching a pattern
npx vitest run --grep "validates app name"

# Run in watch mode
npx vitest
```

## Test file location

Test files live next to their source files:

```
src/core/secrets.ts
src/core/secrets.test.ts
src/commands/deploy.ts
src/commands/deploy.test.ts
```

Exception: TUI integration tests go in `src/tui/tests/`.

## Mocking patterns

### Mocking child_process

Most core modules call external commands via `execSafe`. Mock the exec module:

```typescript
import { vi } from 'vitest';

vi.mock('../core/exec.js', () => ({
  execSafe: vi.fn(() => ({ ok: true, stdout: '', stderr: '' })),
}));
```

### Mocking the filesystem

For modules that read/write files:

```typescript
vi.mock('node:fs', () => ({
  existsSync: vi.fn(() => true),
  readFileSync: vi.fn(() => 'file content'),
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn(),
  unlinkSync: vi.fn(),
  readdirSync: vi.fn(() => []),
}));
```

### Mocking secrets

Secrets tests have a specific pattern because same-module functions can't be mocked at the module level:

<Tabs>
  <TabItem label="secrets.test.ts">
  Mock `node:fs` directly — the secrets module reads files internally.
  </TabItem>
  <TabItem label="secrets-ops.test.ts">
  Mock `./secrets.js` as a module — secrets-ops imports from secrets.
  </TabItem>
</Tabs>

## Security test patterns

Every module that accepts user input should have security tests:

```typescript
describe('security', () => {
  it('rejects command injection in app name', () => {
    expect(() => addCommand(['$(rm -rf /)'])).toThrow();
  });

  it('rejects path traversal', () => {
    expect(() => addCommand(['../../etc/passwd'])).toThrow();
  });

  it('rejects empty input', () => {
    expect(() => addCommand([])).toThrow();
  });
});
```

Cover at minimum:
- Command injection (`; rm -rf /`, `$(cmd)`, `` `cmd` ``)
- Path traversal (`../../etc/passwd`, `/etc/shadow`)
- Invalid / missing arguments
- Oversized input

## Integration tests

Tests that need Docker or systemd skip in CI:

```typescript
const describeIntegration = process.env.CI ? describe.skip : describe;

describeIntegration('boot order', () => {
  // tests that call docker compose...
});
```

## Test configuration

Vitest config is in `package.json` (no separate config file). The test runner uses the same TypeScript/ESM setup as the main build.

<Aside>
The CI matrix runs tests on Node 20 and 22 to catch compatibility issues early.
</Aside>
