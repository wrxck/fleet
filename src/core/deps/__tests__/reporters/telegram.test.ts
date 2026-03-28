import { describe, it, expect } from 'vitest';

import { formatTelegramMessage, findNewFindings } from '../../reporters/telegram.js';
import type { Finding } from '../../types.js';

function makeFinding(overrides: Partial<Finding> = {}): Finding {
  return {
    appName: 'test-app', source: 'npm', severity: 'medium',
    category: 'outdated-dep', title: 'react 18 -> 19', detail: 'update',
    fixable: true, updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('formatTelegramMessage', () => {
  it('formats findings as grouped html message', () => {
    const findings = [
      makeFinding({ severity: 'critical', title: 'lodash CVE' }),
      makeFinding({ severity: 'high', title: 'express 4->5' }),
    ];
    const msg = formatTelegramMessage(findings, 31);
    expect(msg).toContain('Fleet Deps Scan');
    expect(msg).toContain('Critical');
    expect(msg).toContain('lodash CVE');
  });

  it('returns empty string for no findings', () => {
    expect(formatTelegramMessage([], 31)).toBe('');
  });

  it('truncates groups with more than 10 findings', () => {
    const findings = Array.from({ length: 15 }, (_, i) =>
      makeFinding({ severity: 'medium', title: `pkg-${i}` })
    );
    const msg = formatTelegramMessage(findings, 31);
    expect(msg).toContain('...and 5 more');
  });

  it('escapes html in titles', () => {
    const findings = [makeFinding({ severity: 'high', title: '<script>alert(1)</script>' })];
    const msg = formatTelegramMessage(findings, 1);
    expect(msg).toContain('&lt;script&gt;');
    expect(msg).not.toContain('<script>');
  });
});

describe('findNewFindings', () => {
  it('identifies brand new findings', () => {
    const previous = [makeFinding({ title: 'old finding' })];
    const current = [
      makeFinding({ title: 'old finding' }),
      makeFinding({ title: 'new finding' }),
    ];
    const newOnes = findNewFindings(current, previous);
    expect(newOnes).toHaveLength(1);
    expect(newOnes[0].title).toBe('new finding');
  });

  it('identifies severity escalations', () => {
    const previous = [makeFinding({ title: 'react 18 -> 19', severity: 'medium' })];
    const current = [makeFinding({ title: 'react 18 -> 19', severity: 'high' })];
    const newOnes = findNewFindings(current, previous);
    expect(newOnes).toHaveLength(1);
  });

  it('does not flag severity downgrades', () => {
    const previous = [makeFinding({ title: 'react 18 -> 19', severity: 'high' })];
    const current = [makeFinding({ title: 'react 18 -> 19', severity: 'medium' })];
    const newOnes = findNewFindings(current, previous);
    expect(newOnes).toHaveLength(0);
  });

  it('returns all findings when previous is empty', () => {
    const current = [makeFinding(), makeFinding({ title: 'other' })];
    const newOnes = findNewFindings(current, []);
    expect(newOnes).toHaveLength(2);
  });
});
