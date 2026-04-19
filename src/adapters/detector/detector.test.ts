import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { mkExecTmpDir } from '../../core/routines/test-utils.js';
import {
  BUILT_IN_DETECTORS,
  detectStacks,
  dockerDetector,
  genericDetector,
  nodeDetector,
  pythonDetector,
  rustDetector,
} from './index.js';

describe('stack detectors', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkExecTmpDir('fleet-detect-');
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('nodeDetector matches when package.json exists', () => {
    writeFileSync(join(dir, 'package.json'), '{}');
    expect(nodeDetector.detect(dir)).toBeTruthy();
  });

  it('nodeDetector does not match without package.json', () => {
    expect(nodeDetector.detect(dir)).toBeFalsy();
  });

  it('dockerDetector matches on compose file or Dockerfile', () => {
    writeFileSync(join(dir, 'Dockerfile'), 'FROM node');
    expect(dockerDetector.detect(dir)).toBeTruthy();
  });

  it('pythonDetector matches on pyproject.toml', () => {
    writeFileSync(join(dir, 'pyproject.toml'), '[project]');
    expect(pythonDetector.detect(dir)).toBeTruthy();
  });

  it('rustDetector matches on Cargo.toml', () => {
    writeFileSync(join(dir, 'Cargo.toml'), '[package]');
    expect(rustDetector.detect(dir)).toBeTruthy();
  });

  it('genericDetector always matches', () => {
    expect(genericDetector.detect(dir)).toBeTruthy();
  });

  it('detectStacks returns all matching ids, docker first (higher priority)', () => {
    writeFileSync(join(dir, 'package.json'), '{}');
    writeFileSync(join(dir, 'Dockerfile'), 'FROM node');
    const ids = detectStacks(dir);
    expect(ids).toContain('docker');
    expect(ids).toContain('node');
    expect(ids).toContain('generic');
    expect(ids[0]).toBe('docker');
    expect(ids[ids.length - 1]).toBe('generic');
  });

  it('detectStacks on an empty dir returns only generic', () => {
    mkdirSync(join(dir, 'empty'), { recursive: true });
    const ids = detectStacks(join(dir, 'empty'));
    expect(ids).toEqual(['generic']);
  });

  it('BUILT_IN_DETECTORS is immutable', () => {
    expect(Object.isFrozen(BUILT_IN_DETECTORS)).toBeTruthy();
  });
});
