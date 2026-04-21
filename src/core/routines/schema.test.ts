import { describe, it, expect } from 'vitest';

import { RoutineSchema, RoutineTaskSchema, isExpired, type Signal } from './schema.js';

describe('RoutineTaskSchema', () => {
  it('accepts a valid claude-cli task with defaults', () => {
    const parsed = RoutineTaskSchema.parse({ kind: 'claude-cli', prompt: 'run an audit' });
    expect(parsed).toMatchObject({
      kind: 'claude-cli',
      prompt: 'run an audit',
      outputFormat: 'json',
      tokenCap: 100_000,
      wallClockMs: 15 * 60 * 1000,
      maxUsd: 5,
    });
  });

  it('rejects an empty claude-cli prompt', () => {
    expect(() => RoutineTaskSchema.parse({ kind: 'claude-cli', prompt: '' })).toThrow();
  });

  it('caps claude-cli prompt length', () => {
    expect(() => RoutineTaskSchema.parse({ kind: 'claude-cli', prompt: 'x'.repeat(8001) })).toThrow();
  });

  it('accepts a shell task with argv', () => {
    const parsed = RoutineTaskSchema.parse({ kind: 'shell', argv: ['npm', 'test'] });
    expect(parsed.kind).toBe('shell');
    if (parsed.kind === 'shell') expect(parsed.argv).toEqual(['npm', 'test']);
  });

  it('rejects shell argv containing shell metacharacters', () => {
    for (const bad of ['rm -rf /; ls', 'echo $FOO', 'a|b', 'a`b`', 'a>b', 'a&b', 'a\\b']) {
      expect(() => RoutineTaskSchema.parse({ kind: 'shell', argv: [bad] }), `expected reject: ${bad}`).toThrow();
    }
  });

  it('rejects shell argv with invalid env var names', () => {
    expect(() => RoutineTaskSchema.parse({ kind: 'shell', argv: ['ls'], env: { 'lowercase': 'x' } })).toThrow();
  });

  it('accepts an mcp-call task', () => {
    const parsed = RoutineTaskSchema.parse({ kind: 'mcp-call', tool: 'fleet_status', args: { service: 'abmanandvan' } });
    expect(parsed.kind).toBe('mcp-call');
  });

  it('rejects mcp-call tool with invalid name', () => {
    expect(() => RoutineTaskSchema.parse({ kind: 'mcp-call', tool: 'bad name!', args: {} })).toThrow();
  });
});

describe('RoutineSchema', () => {
  const base = {
    id: 'nightly-audit',
    name: 'Nightly Audit',
    schedule: { kind: 'calendar' as const, onCalendar: '*-*-* 02:00:00' },
    task: { kind: 'claude-cli' as const, prompt: 'audit now' },
  };

  it('accepts a minimal routine', () => {
    const parsed = RoutineSchema.parse(base);
    expect(parsed.enabled).toBeTruthy();
    expect(parsed.targets).toEqual([]);
  });

  it('rejects an id with uppercase', () => {
    expect(() => RoutineSchema.parse({ ...base, id: 'Nightly' })).toThrow();
  });

  it('rejects an id starting with a digit', () => {
    expect(() => RoutineSchema.parse({ ...base, id: '9bad' })).toThrow();
  });

  it('rejects an id longer than 63 chars', () => {
    expect(() => RoutineSchema.parse({ ...base, id: `a${'x'.repeat(63)}` })).toThrow();
  });

  it('accepts a single-character id', () => {
    expect(() => RoutineSchema.parse({ ...base, id: 'a' })).not.toThrow();
  });

  it('accepts an id of exactly 63 chars', () => {
    const id = `a${'x'.repeat(62)}`;
    expect(RoutineSchema.parse({ ...base, id }).id).toBe(id);
  });

  it('accepts a manual schedule', () => {
    const parsed = RoutineSchema.parse({ ...base, schedule: { kind: 'manual' } });
    expect(parsed.schedule.kind).toBe('manual');
  });
});

describe('isExpired', () => {
  const mk = (collectedAt: string, ttlMs: number): Signal => ({
    repo: 'x',
    kind: 'git-clean',
    state: 'ok',
    value: true,
    detail: '',
    collectedAt,
    ttlMs,
  });

  it('is expired when ttl has elapsed', () => {
    const sig = mk(new Date(Date.now() - 10_000).toISOString(), 5_000);
    expect(isExpired(sig)).toBeTruthy();
  });

  it('is fresh when within ttl', () => {
    const sig = mk(new Date().toISOString(), 60_000);
    expect(isExpired(sig)).toBeFalsy();
  });
});
