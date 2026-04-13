import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

export default defineConfig({
  site: 'https://fleet.hesketh.pro',
  integrations: [
    starlight({
      title: 'Fleet',
      description: 'Docker production management CLI + MCP server',
      social: {
        github: 'https://github.com/wrxck/fleet',
      },
      editLink: {
        baseUrl: 'https://github.com/wrxck/fleet/edit/feat/docs-site/docs-site/fleet/',
      },
      head: [
        {
          tag: 'script',
          attrs: { type: 'module' },
          content: `
            import mermaid from 'https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs';
            mermaid.initialize({
              startOnLoad: false,
              theme: document.documentElement.dataset.theme === 'dark' ? 'dark' : 'default',
            });
            // Convert mermaid code blocks to rendered diagrams
            document.querySelectorAll('pre > code.language-mermaid').forEach(async (el) => {
              const pre = el.parentElement;
              const container = document.createElement('div');
              container.classList.add('mermaid');
              container.textContent = el.textContent;
              pre.replaceWith(container);
            });
            await mermaid.run({ querySelector: '.mermaid' });
          `,
        },
      ],
      sidebar: [
        {
          label: 'Getting Started',
          items: [
            { label: 'What is Fleet', slug: 'getting-started/what-is-fleet' },
            { label: 'Installation', slug: 'getting-started/installation' },
            { label: 'Quick Start', slug: 'getting-started/quick-start' },
            { label: 'Architecture', slug: 'getting-started/architecture' },
          ],
        },
        {
          label: 'CLI Reference',
          items: [
            { label: 'Overview', slug: 'cli/overview' },
            { label: 'Status', slug: 'cli/status' },
            { label: 'Lifecycle', slug: 'cli/lifecycle' },
            { label: 'Freeze', slug: 'cli/freeze' },
            { label: 'Health', slug: 'cli/health' },
            { label: 'Secrets', slug: 'cli/secrets' },
            { label: 'Nginx', slug: 'cli/nginx' },
            { label: 'Git', slug: 'cli/git' },
            { label: 'Deps', slug: 'cli/deps' },
            { label: 'Watchdog', slug: 'cli/watchdog' },
          ],
        },
        {
          label: 'MCP Server',
          items: [
            { label: 'Setup', slug: 'mcp/setup' },
            { label: 'Tools', slug: 'mcp/tools' },
            { label: 'Claude Code', slug: 'mcp/claude-code' },
          ],
        },
        {
          label: 'Bot',
          items: [
            { label: 'Setup', slug: 'bot/setup' },
            { label: 'Commands', slug: 'bot/commands' },
            { label: 'Alerts', slug: 'bot/alerts' },
            { label: 'Adapters', slug: 'bot/adapters' },
            { label: 'Custom Adapter', slug: 'bot/custom-adapter' },
            { label: 'Security', slug: 'bot/security' },
          ],
        },
        {
          label: 'Secrets Vault',
          items: [
            { label: 'Overview', slug: 'secrets/overview' },
            { label: 'Managing Secrets', slug: 'secrets/managing' },
            { label: 'Safety', slug: 'secrets/safety' },
            { label: 'Docker Integration', slug: 'secrets/docker' },
          ],
        },
        {
          label: 'TUI Dashboard',
          items: [
            { label: 'Navigation', slug: 'tui/navigation' },
            { label: 'Views', slug: 'tui/views' },
          ],
        },
        {
          label: 'Operations',
          items: [
            { label: 'Systemd', slug: 'ops/systemd' },
            { label: 'Nginx', slug: 'ops/nginx' },
            { label: 'Health Checks', slug: 'ops/health' },
            { label: 'Dependencies', slug: 'ops/deps' },
            { label: 'Troubleshooting', slug: 'ops/troubleshooting' },
          ],
        },
        {
          label: 'Development',
          items: [
            { label: 'Contributing', slug: 'dev/contributing' },
            { label: 'Testing', slug: 'dev/testing' },
            { label: 'Release', slug: 'dev/release' },
          ],
        },
      ],
    }),
  ],
});
