import { describe, it, expect } from 'vitest';

import { colors, statusColor, healthColor } from './theme.js';

describe('colors', () => {
  it('has primary color', () => {
    expect(colors.primary).toBeDefined();
    expect(typeof colors.primary).toBe('string');
  });

  it('has success, warning, error colors', () => {
    expect(colors.success).toBeDefined();
    expect(colors.warning).toBeDefined();
    expect(colors.error).toBeDefined();
  });

  it('has info, muted, text colors', () => {
    expect(colors.info).toBeDefined();
    expect(colors.muted).toBeDefined();
    expect(colors.text).toBeDefined();
  });

  it('success is green', () => {
    expect(colors.success).toBe('green');
  });

  it('error is red', () => {
    expect(colors.error).toBe('red');
  });

  it('warning is yellow', () => {
    expect(colors.warning).toBe('yellow');
  });
});

describe('statusColor', () => {
  it('active is green', () => {
    expect(statusColor['active']).toBe('green');
  });

  it('inactive is red', () => {
    expect(statusColor['inactive']).toBe('red');
  });

  it('failed is red', () => {
    expect(statusColor['failed']).toBe('red');
  });

  it('activating is yellow', () => {
    expect(statusColor['activating']).toBe('yellow');
  });

  it('deactivating is yellow', () => {
    expect(statusColor['deactivating']).toBe('yellow');
  });

  it('n/a is gray', () => {
    expect(statusColor['n/a']).toBe('gray');
  });

  it('returns undefined for unknown status', () => {
    expect(statusColor['unknown-status']).toBeUndefined();
  });
});

describe('healthColor', () => {
  it('healthy is green', () => {
    expect(healthColor['healthy']).toBe('green');
  });

  it('degraded is yellow', () => {
    expect(healthColor['degraded']).toBe('yellow');
  });

  it('down is red', () => {
    expect(healthColor['down']).toBe('red');
  });

  it('unknown is gray', () => {
    expect(healthColor['unknown']).toBe('gray');
  });

  it('returns undefined for unrecognised health state', () => {
    expect(healthColor['critical']).toBeUndefined();
  });
});
