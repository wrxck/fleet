import { describe, it, expect } from 'vitest';

import { defaultConfig } from '../config.js';
import { severityFromVersionDelta, severityFromEol, severityFromCvss } from '../severity.js';

const overrides = defaultConfig().severityOverrides;

describe('severityFromVersionDelta', () => {
  it('returns high for major version behind', () => {
    expect(severityFromVersionDelta('1.0.0', '2.0.0', overrides)).toBe('high');
  });

  it('returns medium for minor version behind', () => {
    expect(severityFromVersionDelta('1.0.0', '1.1.0', overrides)).toBe('medium');
  });

  it('returns low for patch version behind', () => {
    expect(severityFromVersionDelta('1.0.0', '1.0.1', overrides)).toBe('low');
  });

  it('returns info when versions match', () => {
    expect(severityFromVersionDelta('1.0.0', '1.0.0', overrides)).toBe('info');
  });

  it('handles v prefix', () => {
    expect(severityFromVersionDelta('v1.0.0', 'v2.0.0', overrides)).toBe('high');
  });

  it('returns medium for non-semver', () => {
    expect(severityFromVersionDelta('latest', '20260328', overrides)).toBe('medium');
  });
});

describe('severityFromEol', () => {
  it('returns critical when EOL has passed', () => {
    expect(severityFromEol('2025-01-01', 90)).toBe('critical');
  });

  it('returns high when EOL within 30 days', () => {
    const soon = new Date(Date.now() + 15 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    expect(severityFromEol(soon, 90)).toBe('high');
  });

  it('returns medium when EOL within warning days', () => {
    const moderate = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    expect(severityFromEol(moderate, 90)).toBe('medium');
  });

  it('returns info when EOL is far away', () => {
    const far = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    expect(severityFromEol(far, 90)).toBe('info');
  });
});

describe('severityFromCvss', () => {
  it('returns critical for CVSS >= 9', () => {
    expect(severityFromCvss(9.5)).toBe('critical');
  });

  it('returns high for CVSS 7-8.9', () => {
    expect(severityFromCvss(7.5)).toBe('high');
  });

  it('returns medium for CVSS 4-6.9', () => {
    expect(severityFromCvss(5.0)).toBe('medium');
  });

  it('returns low for CVSS < 4', () => {
    expect(severityFromCvss(2.0)).toBe('low');
  });
});
