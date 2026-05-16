import { describe, it, expect } from 'vitest';

import { renderLoginPage, renderExplorerPage } from './browser-ui';

describe('backup/browser-ui', () => {
  it('login page has a code input and posts to the login endpoint', () => {
    const html = renderLoginPage();
    expect(html).toContain('<!doctype html>');
    expect(html).toContain('id="code"');
    expect(html).toContain('/backups/api/login');
  });

  it('explorer page wires the api base and csrf header', () => {
    const html = renderExplorerPage();
    expect(html).toContain('<!doctype html>');
    expect(html).toContain('/backups/api/');
    expect(html).toContain('X-Fleet-Backup');
  });

  it('explorer page references the core panels', () => {
    const html = renderExplorerPage();
    expect(html).toContain('id="tree"');
    expect(html).toContain('id="snap"');
    expect(html).toContain('id="staging"');
  });
});
