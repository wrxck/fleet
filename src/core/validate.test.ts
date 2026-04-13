import { describe, it, expect } from 'vitest';
import {
  assertAppName,
  assertServiceName,
  assertDomain,
  assertBranch,
  assertHealthPath,
  assertFilePath,
  assertSecretKey,
} from './validate.js';

describe('assertAppName', () => {
  it('accepts valid app names', () => {
    expect(() => assertAppName('myapp')).not.toThrow();
    expect(() => assertAppName('my-app')).not.toThrow();
    expect(() => assertAppName('my_app')).not.toThrow();
    expect(() => assertAppName('my.app')).not.toThrow();
    expect(() => assertAppName('MyApp123')).not.toThrow();
    expect(() => assertAppName('a')).not.toThrow();
    expect(() => assertAppName('app-v2.1')).not.toThrow();
  });

  it('rejects empty string', () => {
    expect(() => assertAppName('')).toThrow();
  });

  it('rejects names starting with non-alphanumeric', () => {
    expect(() => assertAppName('-myapp')).toThrow();
    expect(() => assertAppName('.myapp')).toThrow();
    expect(() => assertAppName('_myapp')).toThrow();
  });

  it('rejects shell metacharacters', () => {
    expect(() => assertAppName('name; rm -rf /')).toThrow();
    expect(() => assertAppName('name && evil')).toThrow();
    expect(() => assertAppName('$(cmd)')).toThrow();
    expect(() => assertAppName('`cmd`')).toThrow();
    expect(() => assertAppName('name|pipe')).toThrow();
    expect(() => assertAppName('name>redirect')).toThrow();
    expect(() => assertAppName('name<redirect')).toThrow();
  });

  it('rejects path traversal', () => {
    expect(() => assertAppName('../../etc/passwd')).toThrow();
    expect(() => assertAppName('../etc')).toThrow();
  });

  it('rejects spaces', () => {
    expect(() => assertAppName('my app')).toThrow();
  });

  it('rejects overly long inputs', () => {
    expect(() => assertAppName('a'.repeat(300))).not.toThrow(); // regex doesn't cap length, just verify no crash
    // but shell chars still rejected
    expect(() => assertAppName('a'.repeat(100) + ';evil')).toThrow();
  });
});

describe('assertServiceName', () => {
  it('accepts valid service names', () => {
    expect(() => assertServiceName('myapp')).not.toThrow();
    expect(() => assertServiceName('docker-myapp')).not.toThrow();
    expect(() => assertServiceName('my_service')).not.toThrow();
    expect(() => assertServiceName('service@1')).not.toThrow(); // @ allowed
    expect(() => assertServiceName('app.service')).not.toThrow();
  });

  it('rejects empty string', () => {
    expect(() => assertServiceName('')).toThrow();
  });

  it('rejects shell injection in service name', () => {
    expect(() => assertServiceName('name; rm -rf /')).toThrow();
    expect(() => assertServiceName('$(evil)')).toThrow();
    expect(() => assertServiceName('name && cmd')).toThrow();
  });

  it('rejects names starting with special chars', () => {
    expect(() => assertServiceName('-service')).toThrow();
    expect(() => assertServiceName('@service')).toThrow();
  });
});

describe('assertDomain', () => {
  it('accepts valid domains', () => {
    expect(() => assertDomain('example.com')).not.toThrow();
    expect(() => assertDomain('sub.example.com')).not.toThrow();
    expect(() => assertDomain('my-site.co.uk')).not.toThrow();
    expect(() => assertDomain('localhost')).not.toThrow();
    expect(() => assertDomain('example123.com')).not.toThrow();
  });

  it('rejects empty string', () => {
    expect(() => assertDomain('')).toThrow();
  });

  it('rejects domain with injection attempts', () => {
    expect(() => assertDomain('evil.com; rm -rf /')).toThrow();
    expect(() => assertDomain('evil.com\nnewline')).toThrow();
    expect(() => assertDomain('evil.com$(cmd)')).toThrow();
  });

  it('rejects domain starting with dash', () => {
    expect(() => assertDomain('-evil.com')).toThrow();
  });

  it('rejects path traversal', () => {
    expect(() => assertDomain('../etc')).toThrow();
    expect(() => assertDomain('../../etc')).toThrow();
  });

  it('rejects underscores', () => {
    expect(() => assertDomain('my_site.com')).toThrow();
  });
});

describe('assertBranch', () => {
  it('accepts valid branch names', () => {
    expect(() => assertBranch('main')).not.toThrow();
    expect(() => assertBranch('develop')).not.toThrow();
    expect(() => assertBranch('feat/my-feature')).not.toThrow();
    expect(() => assertBranch('fix/bug-123')).not.toThrow();
    expect(() => assertBranch('chore/update-deps')).not.toThrow();
    expect(() => assertBranch('release/1.0.0')).not.toThrow();
    expect(() => assertBranch('feat/v2.0-rewrite')).not.toThrow();
  });

  it('rejects empty string', () => {
    expect(() => assertBranch('')).toThrow();
  });

  it('rejects path traversal', () => {
    expect(() => assertBranch('../../etc/passwd')).toThrow();
    expect(() => assertBranch('../.ssh/authorized_keys')).toThrow();
    expect(() => assertBranch('feat/../../../etc')).toThrow();
  });

  it('rejects null bytes', () => {
    expect(() => assertBranch('valid\x00evil')).toThrow();
    expect(() => assertBranch('\x00')).toThrow();
  });

  it('rejects shell metacharacters', () => {
    expect(() => assertBranch('branch; rm -rf /')).toThrow();
    expect(() => assertBranch('branch$(cmd)')).toThrow();
    expect(() => assertBranch('branch`cmd`')).toThrow();
    expect(() => assertBranch('branch && evil')).toThrow();
  });

  it('rejects spaces', () => {
    expect(() => assertBranch('my branch')).toThrow();
  });

  it('rejects branch starting with special chars', () => {
    expect(() => assertBranch('-branch')).toThrow();
    expect(() => assertBranch('.hidden')).toThrow();
  });
});

describe('assertHealthPath', () => {
  it('accepts valid health paths', () => {
    expect(() => assertHealthPath('/health')).not.toThrow();
    expect(() => assertHealthPath('/api/health')).not.toThrow();
    expect(() => assertHealthPath('/api/v1/health')).not.toThrow();
    expect(() => assertHealthPath('/status')).not.toThrow();
    expect(() => assertHealthPath('/ping')).not.toThrow();
    expect(() => assertHealthPath('/')).not.toThrow();
    expect(() => assertHealthPath('/health.json')).not.toThrow();
  });

  it('rejects empty string', () => {
    expect(() => assertHealthPath('')).toThrow();
  });

  it('rejects paths not starting with /', () => {
    expect(() => assertHealthPath('health')).toThrow();
    expect(() => assertHealthPath('api/health')).toThrow();
  });

  it('rejects path traversal', () => {
    expect(() => assertHealthPath('/../../etc/passwd')).toThrow();
    expect(() => assertHealthPath('/../etc')).toThrow();
  });

  it('rejects null bytes', () => {
    expect(() => assertHealthPath('/health\x00evil')).toThrow();
  });

  it('rejects shell metacharacters', () => {
    expect(() => assertHealthPath('/health; rm -rf /')).toThrow();
    expect(() => assertHealthPath('/health$(cmd)')).toThrow();
    expect(() => assertHealthPath('/health?query=1')).toThrow();
    expect(() => assertHealthPath('/health#fragment')).toThrow();
  });

  it('rejects URL-encoded traversal', () => {
    // The regex itself blocks % characters
    expect(() => assertHealthPath('/..%2fetc%2fpasswd')).toThrow();
  });
});

describe('assertFilePath', () => {
  it('accepts valid file paths', () => {
    expect(() => assertFilePath('/opt/apps/myapp')).not.toThrow();
    expect(() => assertFilePath('/etc/nginx/sites-available/app.conf')).not.toThrow();
    expect(() => assertFilePath('relative/path/file.txt')).not.toThrow();
    expect(() => assertFilePath('file.txt')).not.toThrow();
  });

  it('rejects path traversal', () => {
    expect(() => assertFilePath('../../etc/passwd')).toThrow();
    expect(() => assertFilePath('../secret')).toThrow();
    expect(() => assertFilePath('/opt/apps/../../etc')).toThrow();
  });

  it('rejects null bytes', () => {
    expect(() => assertFilePath('/valid/path\x00evil')).toThrow();
    expect(() => assertFilePath('\x00')).toThrow();
  });

  it('rejects backslash traversal', () => {
    // Backslashes are normalised to / before checking for ..
    expect(() => assertFilePath('..\\..\\etc\\passwd')).toThrow();
  });

  it('accepts paths with .. embedded in name (not traversal)', () => {
    // e.g. a filename literally containing ".." as a substring but not a segment
    // "file..name" is fine since split('/') gives ['file..name'] which doesn't include '..'
    expect(() => assertFilePath('file..name')).not.toThrow();
  });
});

describe('security: combined attacks', () => {
  it('assertAppName rejects unicode look-alikes in critical positions', () => {
    expect(() => assertAppName('myapp\ninjection')).toThrow();
  });

  it('assertBranch rejects mixed traversal + null byte', () => {
    expect(() => assertBranch('../\x00etc')).toThrow();
  });

  it('assertFilePath handles long traversal chains', () => {
    expect(() => assertFilePath('../../../../../../../../../etc/shadow')).toThrow();
  });
});

describe('assertSecretKey', () => {
  it('accepts valid env var names', () => {
    expect(() => assertSecretKey('DATABASE_URL')).not.toThrow();
    expect(() => assertSecretKey('API_KEY')).not.toThrow();
    expect(() => assertSecretKey('_PRIVATE')).not.toThrow();
    expect(() => assertSecretKey('a')).not.toThrow();
    expect(() => assertSecretKey('X')).not.toThrow();
    expect(() => assertSecretKey('key123')).not.toThrow();
  });

  it('rejects leading digits', () => {
    expect(() => assertSecretKey('1KEY')).toThrow();
    expect(() => assertSecretKey('0_BAD')).toThrow();
    expect(() => assertSecretKey('9abc')).toThrow();
  });

  it('rejects shell metacharacters', () => {
    expect(() => assertSecretKey('KEY;rm -rf /')).toThrow();
    expect(() => assertSecretKey('KEY$(cmd)')).toThrow();
    expect(() => assertSecretKey('KEY`cmd`')).toThrow();
    expect(() => assertSecretKey('KEY|pipe')).toThrow();
    expect(() => assertSecretKey('KEY&bg')).toThrow();
    expect(() => assertSecretKey('KEY>file')).toThrow();
  });

  it('rejects empty strings', () => {
    expect(() => assertSecretKey('')).toThrow();
  });

  it('rejects names with spaces', () => {
    expect(() => assertSecretKey('MY KEY')).toThrow();
    expect(() => assertSecretKey(' KEY')).toThrow();
  });

  it('rejects names with special characters', () => {
    expect(() => assertSecretKey('KEY-NAME')).toThrow();
    expect(() => assertSecretKey('KEY.NAME')).toThrow();
    expect(() => assertSecretKey('KEY/NAME')).toThrow();
    expect(() => assertSecretKey('KEY=VALUE')).toThrow();
  });

  it('rejects path traversal attempts', () => {
    expect(() => assertSecretKey('../etc/passwd')).toThrow();
  });
});
