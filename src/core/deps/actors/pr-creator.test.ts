import { describe, it, expect } from 'vitest';

import { generateVersionBump } from './pr-creator';
import type { Finding } from '../types';

function finding(over: Partial<Finding> = {}): Finding {
  return {
    appName: 'demo',
    source: 'npm',
    severity: 'low',
    category: 'outdated-dep',
    title: 'left-pad outdated',
    detail: '',
    package: 'left-pad',
    currentVersion: '1.2.0',
    latestVersion: '1.3.0',
    fixable: true,
    updatedAt: 'now',
    ...over,
  } as Finding;
}

describe('generateVersionBump', () => {
  it('builds an npm package.json bump for clean versions', () => {
    const bump = generateVersionBump(finding());
    expect(bump).not.toBeNull();
    expect(bump!.file).toBe('package.json');
    expect(bump!.replace).toContain('1.3.0');
  });

  it('returns null for a non-fixable finding', () => {
    expect(generateVersionBump(finding({ fixable: false }))).toBeNull();
  });

  it('rejects a registry version carrying shell/markdown payload', () => {
    expect(generateVersionBump(finding({ latestVersion: '1.3.0 && curl evil' }))).toBeNull();
    expect(generateVersionBump(finding({ latestVersion: '1.3.0`id`' }))).toBeNull();
    expect(generateVersionBump(finding({ latestVersion: '[x](http://evil)' }))).toBeNull();
  });

  it('rejects a malicious package name', () => {
    expect(generateVersionBump(finding({ package: 'left-pad; rm -rf /' }))).toBeNull();
    expect(generateVersionBump(finding({ package: 'a b' }))).toBeNull();
  });

  it('accepts conventional version/range forms', () => {
    expect(generateVersionBump(finding({ currentVersion: '1.2.0', latestVersion: '2.0.0-beta.1' }))).not.toBeNull();
    expect(generateVersionBump(finding({ source: 'pip', currentVersion: '1.0', latestVersion: '1.0.1' }))).not.toBeNull();
  });
});
