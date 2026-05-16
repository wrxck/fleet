import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { loadOperator, _resetOperatorCache } from './operator';

let dir: string;

describe('loadOperator', () => {
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'fleet-operator-'));
    _resetOperatorCache();
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    delete process.env.FLEET_OPERATOR_PATH;
    _resetOperatorCache();
  });

  it('reads operator identity from the json file', () => {
    writeFileSync(join(dir, 'operator.json'), JSON.stringify({
      username: 'alice', homeDir: '/home/alice', domain: 'fleet.alice.dev', githubOrg: 'alice-org',
    }));
    process.env.FLEET_OPERATOR_PATH = join(dir, 'operator.json');
    expect(loadOperator()).toEqual({
      username: 'alice', homeDir: '/home/alice', domain: 'fleet.alice.dev', githubOrg: 'alice-org',
    });
  });

  it('throws a clear error when the file is missing', () => {
    process.env.FLEET_OPERATOR_PATH = join(dir, 'nope.json');
    expect(() => loadOperator()).toThrowError(/operator config/i);
  });

  it('throws when a required field is missing', () => {
    writeFileSync(join(dir, 'operator.json'), JSON.stringify({ username: 'alice' }));
    process.env.FLEET_OPERATOR_PATH = join(dir, 'operator.json');
    expect(() => loadOperator()).toThrowError(/homeDir|domain|githubOrg/);
  });
});
