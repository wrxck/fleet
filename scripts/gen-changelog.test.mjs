// minimal smoke test for scripts/gen-changelog.mjs. invoked from vitest
// via the alias added to vitest.config.ts.

import { describe, it, expect } from 'vitest';

import { bucket, listTags } from './gen-changelog.mjs';

describe('gen-changelog', () => {
  it('buckets subjects by conventional-commit prefix', () => {
    const r = bucket([
      'feat(x): add y',
      'fix(z): close race',
      'chore(deps): bump',
      'docs(readme): polish',
      'test(x): cover edge',
      'feat(api): big move',
    ]);
    expect(r.feats).toEqual(['feat(x): add y', 'feat(api): big move']);
    expect(r.fixes).toEqual(['fix(z): close race']);
    expect(r.others).toEqual([
      'chore(deps): bump',
      'docs(readme): polish',
      'test(x): cover edge',
    ]);
  });

  it('listTags returns semver-shaped tags only', () => {
    const tags = listTags();
    // the repo has at least the v1.0.0 baseline tagged.
    expect(tags.length).toBeGreaterThan(0);
    for (const t of tags) {
      expect(t).toMatch(/^v\d+\.\d+(\.\d+)?(-\d+)?$/);
    }
  });
});
