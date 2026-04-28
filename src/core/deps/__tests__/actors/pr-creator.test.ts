import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

vi.mock('../../../exec.js', () => ({
  execSafe: vi.fn(),
  execGit: vi.fn(),
}));

vi.mock('../../../git.js', () => ({
  getGitStatus: vi.fn(),
}));

import { generateVersionBump, buildPrBody, createDepsPr } from '../../actors/pr-creator.js';
import type { Finding } from '../../types.js';
import type { AppEntry } from '../../../registry.js';
import { execSafe } from '../../../exec.js';
import { getGitStatus } from '../../../git.js';

const mockExecSafe = vi.mocked(execSafe);
const mockGetGitStatus = vi.mocked(getGitStatus);

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

function makeApp(overrides: Partial<AppEntry> = {}): AppEntry {
  return {
    name: 'test-app',
    composePath: '/tmp/fake-app',
    ...overrides,
  } as AppEntry;
}

function cleanGitStatus(branch = 'develop') {
  return {
    initialised: true,
    branch,
    branches: [branch],
    remoteName: 'origin',
    remoteUrl: 'git@github.com:foo/bar.git',
    clean: true,
    staged: 0,
    modified: 0,
    untracked: 0,
    ahead: 0,
    behind: 0,
  };
}

describe('generateVersionBump', () => {
  it('generates package.json regex for npm finding', () => {
    const bump = generateVersionBump(makeFinding({ source: 'npm' }));
    expect(bump).not.toBeNull();
    expect(bump!.file).toBe('package.json');
    expect(bump!.searchRegex).toBeInstanceOf(RegExp);
    expect(bump!.replace).toContain('19.1.0');
  });

  it('matches npm dependency with leading caret range and preserves it', () => {
    const bump = generateVersionBump(makeFinding({
      source: 'npm', package: 'foo', currentVersion: '1.2.3', latestVersion: '2.0.0',
    }));
    expect(bump).not.toBeNull();
    const before = `{
  "dependencies": {
    "foo": "^1.2.3"
  }
}`;
    const after = before.replace(bump!.searchRegex, bump!.replace);
    expect(after).toContain('"foo": "^2.0.0"');
    expect(after).not.toContain('1.2.3');
  });

  it('matches npm dependency with leading tilde range and preserves it', () => {
    const bump = generateVersionBump(makeFinding({
      source: 'npm', package: 'foo', currentVersion: '1.2.3', latestVersion: '2.0.0',
    }));
    const before = `{ "dependencies": { "foo": "~1.2.3" } }`;
    const after = before.replace(bump!.searchRegex, bump!.replace);
    expect(after).toContain('"foo": "~2.0.0"');
  });

  it('matches npm dependency with no range prefix', () => {
    const bump = generateVersionBump(makeFinding({
      source: 'npm', package: 'foo', currentVersion: '1.2.3', latestVersion: '2.0.0',
    }));
    const before = `{ "dependencies": { "foo": "1.2.3" } }`;
    const after = before.replace(bump!.searchRegex, bump!.replace);
    expect(after).toContain('"foo": "2.0.0"');
  });

  it('matches npm dependency with >= range prefix and preserves it', () => {
    const bump = generateVersionBump(makeFinding({
      source: 'npm', package: 'foo', currentVersion: '1.2.3', latestVersion: '2.0.0',
    }));
    const before = `{ "dependencies": { "foo": ">=1.2.3" } }`;
    const after = before.replace(bump!.searchRegex, bump!.replace);
    expect(after).toContain('"foo": ">=2.0.0"');
  });

  it('escapes regex metacharacters in package names (scoped packages)', () => {
    const bump = generateVersionBump(makeFinding({
      source: 'npm', package: '@types/node', currentVersion: '20.0.0', latestVersion: '22.0.0',
    }));
    const before = `{ "devDependencies": { "@types/node": "^20.0.0" } }`;
    const after = before.replace(bump!.searchRegex, bump!.replace);
    expect(after).toContain('"@types/node": "^22.0.0"');
  });

  it('generates composer.json regex for composer finding', () => {
    const bump = generateVersionBump(makeFinding({ source: 'composer', package: 'laravel/framework' }));
    expect(bump).not.toBeNull();
    expect(bump!.file).toBe('composer.json');
  });

  it('generates requirements.txt regex for pip finding', () => {
    const bump = generateVersionBump(makeFinding({ source: 'pip', package: 'django' }));
    expect(bump).not.toBeNull();
    expect(bump!.file).toBe('requirements.txt');
    const before = `django==18.3.1\n`;
    const after = before.replace(bump!.searchRegex, bump!.replace);
    expect(after).toContain('django==19.1.0');
  });

  it('generates Dockerfile regex for docker-image finding', () => {
    const bump = generateVersionBump(makeFinding({
      source: 'docker-image', package: 'node',
      currentVersion: '18-alpine', latestVersion: '20-alpine',
    }));
    expect(bump).not.toBeNull();
    expect(bump!.file).toBe('Dockerfile');
    const before = `FROM node:18-alpine\n`;
    const after = before.replace(bump!.searchRegex, bump!.replace);
    expect(after).toContain('FROM node:20-alpine');
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

describe('createDepsPr', () => {
  let tmpRoot: string;

  beforeEach(() => {
    vi.clearAllMocks();
    tmpRoot = mkdtempSync(join(tmpdir(), 'pr-creator-test-'));
    // Default: every git command succeeds.
    mockExecSafe.mockReturnValue({ stdout: '', stderr: '', exitCode: 0, ok: true });
    mockGetGitStatus.mockReturnValue(cleanGitStatus());
  });

  afterEach(() => {
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('returns no-op shape when no fixable findings', () => {
    const app = makeApp({ composePath: tmpRoot });
    const res = createDepsPr(app, [], false);
    expect(res.bumps).toHaveLength(0);
    expect(res.branch).toBe('');
    expect(mockExecSafe).not.toHaveBeenCalled();
  });

  it('returns dry-run preview without invoking git', () => {
    const app = makeApp({ composePath: tmpRoot });
    const res = createDepsPr(app, [makeFinding()], true);
    expect(res.branch).toMatch(/^deps\/test-app\//);
    expect(res.bumps).toHaveLength(1);
    expect(mockExecSafe).not.toHaveBeenCalled();
    expect(mockGetGitStatus).not.toHaveBeenCalled();
  });

  it('returns error and skips git ops when working tree is dirty', () => {
    mockGetGitStatus.mockReturnValue({
      ...cleanGitStatus(),
      clean: false,
      modified: 1,
    });
    const app = makeApp({ composePath: tmpRoot });
    const res = createDepsPr(app, [makeFinding()], false);
    expect(res.error).toBeDefined();
    expect(res.error).toContain('dirty');
    expect(res.branch).toBe('');
    expect(mockExecSafe).not.toHaveBeenCalled();
  });

  it('returns error when path is not a git repo', () => {
    mockGetGitStatus.mockReturnValue({
      ...cleanGitStatus(),
      initialised: false,
    });
    const app = makeApp({ composePath: tmpRoot });
    const res = createDepsPr(app, [makeFinding()], false);
    expect(res.error).toBeDefined();
    expect(res.error).toContain('not a git repo');
    expect(mockExecSafe).not.toHaveBeenCalled();
  });

  it('aborts before commit/push when no file actually changes', () => {
    // Write a package.json whose version does NOT match the finding — regex
    // will fail to match, so no file is changed.
    writeFileSync(
      join(tmpRoot, 'package.json'),
      JSON.stringify({ dependencies: { foo: '^9.9.9' } }, null, 2),
    );
    const app = makeApp({ composePath: tmpRoot });
    const res = createDepsPr(
      app,
      [makeFinding({ package: 'foo', currentVersion: '1.2.3', latestVersion: '2.0.0' })],
      false,
    );

    expect(res.error).toBeDefined();
    expect(res.error).toContain('no files changed');
    // Should have run checkout develop, pull, checkout -b — but never add/commit/push.
    const calls = mockExecSafe.mock.calls.map(c => (c[1] as string[]).join(' '));
    expect(calls.some(c => c.includes('add'))).toBe(false);
    expect(calls.some(c => c.includes('commit'))).toBe(false);
    expect(calls.some(c => c.includes('push'))).toBe(false);
  });

  it('rewrites a caret-range package.json end-to-end and commits/pushes', () => {
    writeFileSync(
      join(tmpRoot, 'package.json'),
      `{
  "dependencies": {
    "foo": "^1.2.3"
  }
}`,
    );
    const app = makeApp({ composePath: tmpRoot, gitRepo: undefined });
    const res = createDepsPr(
      app,
      [makeFinding({ package: 'foo', currentVersion: '1.2.3', latestVersion: '2.0.0' })],
      false,
    );

    expect(res.error).toBeUndefined();
    expect(res.branch).toMatch(/^deps\/test-app\//);
    const after = readFileSync(join(tmpRoot, 'package.json'), 'utf-8');
    expect(after).toContain('"foo": "^2.0.0"');
    // Verify the full git sequence was issued.
    const calls = mockExecSafe.mock.calls.map(c => (c[1] as string[]).join(' '));
    expect(calls.some(c => c.includes('checkout develop'))).toBe(true);
    expect(calls.some(c => c.startsWith('pull'))).toBe(true);
    expect(calls.some(c => c.includes('add package.json'))).toBe(true);
    expect(calls.some(c => c.startsWith('commit '))).toBe(true);
    expect(calls.some(c => c.startsWith('push '))).toBe(true);
  });

  it('surfaces git checkout failure and aborts', () => {
    mockExecSafe.mockImplementation((_cmd, args) => {
      if (args[0] === 'checkout' && args[1] === 'develop') {
        return { stdout: '', stderr: 'pathspec did not match', exitCode: 1, ok: false };
      }
      return { stdout: '', stderr: '', exitCode: 0, ok: true };
    });
    const app = makeApp({ composePath: tmpRoot });
    const res = createDepsPr(app, [makeFinding()], false);
    expect(res.error).toBeDefined();
    expect(res.error).toContain('git checkout develop failed');
  });
});
