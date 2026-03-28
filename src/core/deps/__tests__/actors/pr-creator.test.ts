import { describe, it, expect } from 'vitest';

import { generateVersionBump, buildPrBody } from '../../actors/pr-creator.js';
import type { Finding } from '../../types.js';

function makeFinding(overrides: Partial<Finding> = {}): Finding {
  return {
    appName: 'test-app', source: 'npm', severity: 'medium',
    category: 'outdated-dep', title: 'react 18.3.1 -> 19.1.0',
    detail: 'update', package: 'react',
    currentVersion: '18.3.1', latestVersion: '19.1.0',
    fixable: true, updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('generateVersionBump', () => {
  it('generates package.json replacement for npm finding', () => {
    const bump = generateVersionBump(makeFinding({ source: 'npm' }));
    expect(bump).not.toBeNull();
    expect(bump!.file).toBe('package.json');
    expect(bump!.search).toContain('18.3.1');
    expect(bump!.replace).toContain('19.1.0');
  });

  it('generates composer.json replacement for composer finding', () => {
    const bump = generateVersionBump(makeFinding({ source: 'composer', package: 'laravel/framework' }));
    expect(bump).not.toBeNull();
    expect(bump!.file).toBe('composer.json');
  });

  it('generates requirements.txt replacement for pip finding', () => {
    const bump = generateVersionBump(makeFinding({ source: 'pip', package: 'django' }));
    expect(bump).not.toBeNull();
    expect(bump!.file).toBe('requirements.txt');
    expect(bump!.search).toContain('django==18.3.1');
  });

  it('generates Dockerfile replacement for docker-image finding', () => {
    const bump = generateVersionBump(makeFinding({
      source: 'docker-image', package: 'node',
      currentVersion: '18-alpine', latestVersion: '20-alpine',
    }));
    expect(bump).not.toBeNull();
    expect(bump!.file).toBe('Dockerfile');
  });

  it('returns null for non-fixable findings', () => {
    expect(generateVersionBump(makeFinding({ fixable: false }))).toBeNull();
  });

  it('returns null for missing version info', () => {
    expect(generateVersionBump(makeFinding({ currentVersion: undefined }))).toBeNull();
  });

  it('returns null for unsupported source types', () => {
    expect(generateVersionBump(makeFinding({ source: 'eol' }))).toBeNull();
  });
});

describe('buildPrBody', () => {
  it('includes all findings in a table', () => {
    const findings = [
      makeFinding({ title: 'react 18 -> 19', package: 'react' }),
      makeFinding({ title: 'express 4 -> 5', package: 'express' }),
    ];
    const body = buildPrBody(findings);
    expect(body).toContain('react');
    expect(body).toContain('express');
    expect(body).toContain('npm install');
  });

  it('includes post-merge steps for relevant ecosystems', () => {
    const findings = [
      makeFinding({ source: 'npm' }),
      makeFinding({ source: 'pip', package: 'django' }),
    ];
    const body = buildPrBody(findings);
    expect(body).toContain('npm install');
    expect(body).toContain('pip install');
  });

  it('includes docker rebuild step for image findings', () => {
    const findings = [makeFinding({ source: 'docker-image', package: 'node' })];
    const body = buildPrBody(findings);
    expect(body).toContain('Rebuild Docker image');
  });
});
