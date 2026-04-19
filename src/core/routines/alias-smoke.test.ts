import { describe, it, expect } from 'vitest';

import { RoutineSchema } from '@/core/routines/schema.js';

describe('@/ path alias', () => {
  it('resolves @/* to src/* in vitest', () => {
    const parsed = RoutineSchema.parse({
      id: 'alias-test',
      name: 'alias test',
      schedule: { kind: 'manual' },
      task: { kind: 'shell', argv: ['echo', 'ok'] },
    });
    expect(parsed.id).toBe('alias-test');
  });
});
