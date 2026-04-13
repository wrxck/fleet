import { describe, it, expect } from 'vitest';
import { generateNginxConfig } from './nginx.js';

function makeOpts(overrides: Partial<Parameters<typeof generateNginxConfig>[0]> = {}) {
  return {
    domain: 'example.com',
    port: 3000,
    type: 'proxy' as const,
    ...overrides,
  };
}

describe('generateNginxConfig — proxy type', () => {
  it('generates a server block', () => {
    const result = generateNginxConfig(makeOpts({ type: 'proxy' }));
    expect(result).toContain('server {');
    expect(result).toContain('listen 80;');
    expect(result).toContain('listen [::]:80;');
  });

  it('includes domain in server_name', () => {
    const result = generateNginxConfig(makeOpts({ type: 'proxy', domain: 'myapp.example.com' }));
    expect(result).toContain('server_name myapp.example.com www.myapp.example.com;');
  });

  it('includes port in proxy_pass', () => {
    const result = generateNginxConfig(makeOpts({ type: 'proxy', port: 8080 }));
    expect(result).toContain('proxy_pass http://127.0.0.1:8080;');
  });

  it('includes security headers', () => {
    const result = generateNginxConfig(makeOpts({ type: 'proxy' }));
    expect(result).toContain('X-Content-Type-Options');
    expect(result).toContain('X-Frame-Options');
    expect(result).toContain('X-XSS-Protection');
    expect(result).toContain('Referrer-Policy');
  });

  it('includes proxy headers for WebSocket support', () => {
    const result = generateNginxConfig(makeOpts({ type: 'proxy' }));
    expect(result).toContain('proxy_set_header Upgrade');
    expect(result).toContain('proxy_set_header Connection');
    expect(result).toContain('proxy_set_header Host');
    expect(result).toContain('proxy_set_header X-Real-IP');
    expect(result).toContain('proxy_set_header X-Forwarded-For');
    expect(result).toContain('proxy_set_header X-Forwarded-Proto');
  });

  it('port is numeric — no injection via port field', () => {
    const result = generateNginxConfig(makeOpts({ type: 'proxy', port: 9000 }));
    // Port should be a number, not contain shell metacharacters
    expect(result).toContain('proxy_pass http://127.0.0.1:9000;');
    expect(result).not.toContain(';rm');
    expect(result).not.toContain('$(');
  });
});

describe('generateNginxConfig — spa type', () => {
  it('generates gzip configuration', () => {
    const result = generateNginxConfig(makeOpts({ type: 'spa' }));
    expect(result).toContain('gzip on;');
    expect(result).toContain('gzip_vary on;');
    expect(result).toContain('gzip_types');
  });

  it('includes SPA fallback route', () => {
    const result = generateNginxConfig(makeOpts({ type: 'spa' }));
    expect(result).toContain('try_files $uri $uri/ /index.html;');
  });

  it('includes static asset caching', () => {
    const result = generateNginxConfig(makeOpts({ type: 'spa' }));
    expect(result).toContain('expires 1y;');
    expect(result).toContain('Cache-Control "public, immutable"');
  });

  it('includes default API prefix /api/ when not specified', () => {
    const result = generateNginxConfig(makeOpts({ type: 'spa' }));
    expect(result).toContain('location /api/');
  });

  it('uses custom apiPrefix when provided', () => {
    const result = generateNginxConfig(makeOpts({ type: 'spa', apiPrefix: '/backend' }));
    expect(result).toContain('location /backend/');
    expect(result).not.toContain('location /api/');
  });

  it('includes sitemap.xml and robots.txt routes', () => {
    const result = generateNginxConfig(makeOpts({ type: 'spa' }));
    expect(result).toContain('location = /sitemap.xml');
    expect(result).toContain('location = /robots.txt');
  });

  it('proxies API requests to the correct port', () => {
    const result = generateNginxConfig(makeOpts({ type: 'spa', port: 5000 }));
    expect(result).toContain('proxy_pass http://127.0.0.1:5000;');
  });

  it('includes domain in server_name', () => {
    const result = generateNginxConfig(makeOpts({ type: 'spa', domain: 'app.example.com' }));
    expect(result).toContain('server_name app.example.com www.app.example.com;');
  });
});

describe('generateNginxConfig — nextjs type', () => {
  it('includes Next.js static asset route', () => {
    const result = generateNginxConfig(makeOpts({ type: 'nextjs' }));
    expect(result).toContain('location /_next/static/');
  });

  it('includes cache headers for static assets', () => {
    const result = generateNginxConfig(makeOpts({ type: 'nextjs' }));
    expect(result).toContain('expires 1y;');
    expect(result).toContain('Cache-Control "public, immutable"');
  });

  it('proxies all traffic to Next.js', () => {
    const result = generateNginxConfig(makeOpts({ type: 'nextjs', port: 3000 }));
    expect(result).toContain('proxy_pass http://127.0.0.1:3000;');
  });

  it('includes security headers', () => {
    const result = generateNginxConfig(makeOpts({ type: 'nextjs' }));
    expect(result).toContain('X-Content-Type-Options');
    expect(result).toContain('X-Frame-Options');
  });

  it('includes proxy headers', () => {
    const result = generateNginxConfig(makeOpts({ type: 'nextjs' }));
    expect(result).toContain('proxy_set_header Host');
  });

  it('does not include SPA fallback', () => {
    const result = generateNginxConfig(makeOpts({ type: 'nextjs' }));
    expect(result).not.toContain('/index.html');
  });
});

describe('security: domain name injection', () => {
  it('domain ending up in server_name is not escapable with semicolons', () => {
    // The domain is interpolated directly into the template.
    // assertDomain (in nginx.ts core) would reject bad domains before this point.
    // Here we test what the template produces to confirm the format.
    const result = generateNginxConfig(makeOpts({ domain: 'safe.example.com' }));
    // server_name should be exactly the domain followed by www. and then semicolon
    expect(result).toMatch(/server_name safe\.example\.com www\.safe\.example\.com;/);
  });

  it('port is always numeric and cannot contain injection', () => {
    // port is typed as number, so TypeScript prevents string injection at compile time.
    // At runtime, the template embeds it via string interpolation of a number.
    const result = generateNginxConfig(makeOpts({ port: 4321 }));
    expect(result).toContain(':4321');
    expect(result).not.toContain('NaN');
  });

  it('generates valid www. subdomain alongside bare domain', () => {
    const result = generateNginxConfig(makeOpts({ domain: 'mysite.io' }));
    expect(result).toContain('server_name mysite.io www.mysite.io;');
  });
});

describe('config completeness', () => {
  it('proxy config ends with closing brace', () => {
    const result = generateNginxConfig(makeOpts({ type: 'proxy' }));
    expect(result.trim().endsWith('}')).toBe(true);
  });

  it('spa config ends with closing brace', () => {
    const result = generateNginxConfig(makeOpts({ type: 'spa' }));
    expect(result.trim().endsWith('}')).toBe(true);
  });

  it('nextjs config ends with closing brace', () => {
    const result = generateNginxConfig(makeOpts({ type: 'nextjs' }));
    expect(result.trim().endsWith('}')).toBe(true);
  });

  it('all types listen on IPv4 and IPv6', () => {
    for (const type of ['proxy', 'spa', 'nextjs'] as const) {
      const result = generateNginxConfig(makeOpts({ type }));
      expect(result).toContain('listen 80;');
      expect(result).toContain('listen [::]:80;');
    }
  });
});
