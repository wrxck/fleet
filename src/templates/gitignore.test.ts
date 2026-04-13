import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('node:fs', async () => {
  const actual = await vi.importActual<typeof import('node:fs')>('node:fs');
  return { ...actual, existsSync: vi.fn().mockReturnValue(false) };
});

import { existsSync } from 'node:fs';
import { detectProjectType, generateGitignore } from './gitignore.js';

const mockExists = existsSync as ReturnType<typeof vi.fn>;

beforeEach(() => {
  mockExists.mockReturnValue(false);
});

describe('detectProjectType', () => {
  it('returns generic when no indicator files exist', () => {
    expect(detectProjectType('/some/dir')).toBe('generic');
  });

  it('detects next.config.js as nextjs', () => {
    mockExists.mockImplementation((p: string) => String(p).endsWith('next.config.js'));
    expect(detectProjectType('/app')).toBe('nextjs');
  });

  it('detects next.config.mjs as nextjs', () => {
    mockExists.mockImplementation((p: string) => String(p).endsWith('next.config.mjs'));
    expect(detectProjectType('/app')).toBe('nextjs');
  });

  it('detects next.config.ts as nextjs', () => {
    mockExists.mockImplementation((p: string) => String(p).endsWith('next.config.ts'));
    expect(detectProjectType('/app')).toBe('nextjs');
  });

  it('detects package.json as node', () => {
    mockExists.mockImplementation((p: string) => String(p).endsWith('package.json'));
    expect(detectProjectType('/app')).toBe('node');
  });

  it('detects go.mod as go', () => {
    mockExists.mockImplementation((p: string) => String(p).endsWith('go.mod'));
    expect(detectProjectType('/app')).toBe('go');
  });

  it('detects composer.json as php', () => {
    mockExists.mockImplementation((p: string) => String(p).endsWith('composer.json'));
    expect(detectProjectType('/app')).toBe('php');
  });

  it('nextjs takes priority over node (both next.config.js and package.json)', () => {
    mockExists.mockImplementation((p: string) =>
      String(p).endsWith('next.config.js') || String(p).endsWith('package.json')
    );
    expect(detectProjectType('/app')).toBe('nextjs');
  });
});

describe('generateGitignore', () => {
  it('always includes .env in output', () => {
    expect(generateGitignore('generic')).toContain('.env');
  });

  it('always includes .DS_Store', () => {
    expect(generateGitignore('generic')).toContain('.DS_Store');
  });

  it('always includes docker-compose.override.yml', () => {
    expect(generateGitignore('generic')).toContain('docker-compose.override.yml');
  });

  it('always includes secrets reminder footer', () => {
    for (const type of ['node', 'nextjs', 'go', 'php', 'generic'] as const) {
      expect(generateGitignore(type)).toContain('check for secrets before committing');
    }
  });

  it('includes node_modules for node type', () => {
    expect(generateGitignore('node')).toContain('node_modules/');
  });

  it('includes node_modules and .next/ for nextjs type', () => {
    const out = generateGitignore('nextjs');
    expect(out).toContain('node_modules/');
    expect(out).toContain('.next/');
  });

  it('includes bin/ for go type', () => {
    expect(generateGitignore('go')).toContain('bin/');
  });

  it('includes /vendor/ for php type', () => {
    expect(generateGitignore('php')).toContain('/vendor/');
  });

  it('generic type does not include node_modules', () => {
    expect(generateGitignore('generic')).not.toContain('node_modules/');
  });

  it('never omits .env.example (negated pattern)', () => {
    for (const type of ['node', 'nextjs', 'go', 'php', 'generic'] as const) {
      expect(generateGitignore(type)).toContain('!.env.example');
    }
  });

  it('path traversal prevention: secrets section is prominent', () => {
    const out = generateGitignore('node');
    expect(out).toContain('SECRETS - NEVER COMMIT');
    // .env must appear before node_modules (secrets before build artifacts)
    const envIdx = out.indexOf('.env');
    const nmIdx = out.indexOf('node_modules/');
    expect(envIdx).toBeLessThan(nmIdx);
  });
});
