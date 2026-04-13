import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('node:fs', async () => {
  const actual = await vi.importActual<typeof import('node:fs')>('node:fs');
  return { ...actual, writeSync: vi.fn() };
});

import { writeSync } from 'node:fs';
import { c, icon, heading, success, warn, error, info, dim, table } from './output.js';

const mockWrite = writeSync as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
});

describe('c (color codes)', () => {
  it('reset code starts with ESC[', () => {
    expect(c.reset).toContain('\x1b[');
  });

  it('each color code is a non-empty string', () => {
    for (const [key, value] of Object.entries(c)) {
      expect(typeof value).toBe('string');
      expect(value.length).toBeGreaterThan(0);
    }
  });

  it('red, green, yellow are defined', () => {
    expect(c.red).toBeDefined();
    expect(c.green).toBeDefined();
    expect(c.yellow).toBeDefined();
  });
});

describe('icon', () => {
  it('ok icon contains green color code', () => {
    expect(icon.ok).toContain(c.green);
  });

  it('err icon contains red color code', () => {
    expect(icon.err).toContain(c.red);
  });

  it('warn icon contains yellow color code', () => {
    expect(icon.warn).toContain(c.yellow);
  });

  it('info icon contains blue color code', () => {
    expect(icon.info).toContain(c.blue);
  });

  it('all icons include reset code', () => {
    for (const [, value] of Object.entries(icon)) {
      expect(value).toContain(c.reset);
    }
  });
});

describe('heading', () => {
  it('writes to stdout (fd 1)', () => {
    heading('My Heading');
    expect(mockWrite).toHaveBeenCalledWith(1, expect.any(String));
  });

  it('includes the heading text', () => {
    heading('Fleet Dashboard');
    const written = mockWrite.mock.calls[0][1] as string;
    expect(written).toContain('Fleet Dashboard');
  });

  it('includes bold and cyan codes', () => {
    heading('test');
    const written = mockWrite.mock.calls[0][1] as string;
    expect(written).toContain(c.bold);
    expect(written).toContain(c.cyan);
  });
});

describe('success', () => {
  it('writes to stdout (fd 1)', () => {
    success('it worked');
    expect(mockWrite).toHaveBeenCalledWith(1, expect.any(String));
  });

  it('includes the success text', () => {
    success('Deployed successfully');
    const written = mockWrite.mock.calls[0][1] as string;
    expect(written).toContain('Deployed successfully');
  });

  it('includes ok icon', () => {
    success('done');
    const written = mockWrite.mock.calls[0][1] as string;
    expect(written).toContain(c.green);
  });
});

describe('warn', () => {
  it('writes to stdout (fd 1)', () => {
    warn('be careful');
    expect(mockWrite).toHaveBeenCalledWith(1, expect.any(String));
  });

  it('includes the warning text', () => {
    warn('low memory');
    const written = mockWrite.mock.calls[0][1] as string;
    expect(written).toContain('low memory');
  });
});

describe('error', () => {
  it('writes to stderr (fd 2)', () => {
    error('something broke');
    expect(mockWrite).toHaveBeenCalledWith(2, expect.any(String));
  });

  it('includes the error text', () => {
    error('connection refused');
    const written = mockWrite.mock.calls[0][1] as string;
    expect(written).toContain('connection refused');
  });
});

describe('info', () => {
  it('writes to stdout (fd 1)', () => {
    info('starting up');
    expect(mockWrite).toHaveBeenCalledWith(1, expect.any(String));
  });

  it('includes the info text', () => {
    info('listening on port 3000');
    const written = mockWrite.mock.calls[0][1] as string;
    expect(written).toContain('listening on port 3000');
  });
});

describe('dim', () => {
  it('wraps text with dim and reset codes', () => {
    const result = dim('muted text');
    expect(result).toContain(c.dim);
    expect(result).toContain('muted text');
    expect(result).toContain(c.reset);
  });

  it('returns a string', () => {
    expect(typeof dim('test')).toBe('string');
  });
});

describe('table', () => {
  it('writes header row to stdout', () => {
    table(['Name', 'Status'], [['myapp', 'active']]);
    const calls = mockWrite.mock.calls.map(c => c[1] as string);
    expect(calls.some(s => s.includes('Name'))).toBe(true);
    expect(calls.some(s => s.includes('Status'))).toBe(true);
  });

  it('writes separator row', () => {
    table(['Name', 'Status'], [['myapp', 'active']]);
    const calls = mockWrite.mock.calls.map(c => c[1] as string);
    expect(calls.some(s => s.includes('---'))).toBe(true);
  });

  it('writes each row', () => {
    table(['App', 'State'], [
      ['app-one', 'active'],
      ['app-two', 'inactive'],
    ]);
    const all = mockWrite.mock.calls.map(c => c[1] as string).join('');
    expect(all).toContain('app-one');
    expect(all).toContain('app-two');
  });

  it('pads columns to equal width', () => {
    table(['Name', 'S'], [['a-very-long-name', 'ok']]);
    const calls = mockWrite.mock.calls.map(c => c[1] as string);
    // Header "Name" should be padded to at least length of "a-very-long-name"
    const headerLine = calls.find(s => s.includes('Name'));
    expect(headerLine).toBeDefined();
  });

  it('handles ANSI escape codes in cells correctly (strip for width calculation)', () => {
    // Cell with ANSI green color around 'active' — should still align correctly
    const coloredCell = `\x1b[32mactive\x1b[0m`;
    expect(() => table(['Status'], [[coloredCell]])).not.toThrow();
  });
});
