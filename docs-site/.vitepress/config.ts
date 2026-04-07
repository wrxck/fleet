import { defineConfig } from 'vitepress';

export default defineConfig({
  title: '@matthesketh/ink',
  description: 'The most comprehensive component library for Ink — 30 packages for building modern terminal UIs with React',
  head: [
    ['link', { rel: 'icon', type: 'image/svg+xml', href: '/logo.svg' }],
  ],
  themeConfig: {
    logo: '/logo.svg',
    nav: [
      { text: 'Guide', link: '/guide/getting-started' },
      { text: 'Components', link: '/packages/core/ink-viewport' },
      {
        text: 'Links',
        items: [
          { text: 'GitHub', link: 'https://github.com/wrxck/fleet' },
          { text: 'npm', link: 'https://www.npmjs.com/org/matthesketh' },
        ],
      },
    ],
    sidebar: {
      '/guide/': [
        {
          text: 'Introduction',
          items: [
            { text: 'Getting Started', link: '/guide/getting-started' },
            { text: 'Why @matthesketh/ink?', link: '/guide/why' },
            { text: 'Architecture', link: '/guide/architecture' },
          ],
        },
      ],
      '/packages/': [
        {
          text: 'Core',
          items: [
            { text: 'ink-viewport', link: '/packages/core/ink-viewport' },
            { text: 'ink-scrollable-list', link: '/packages/core/ink-scrollable-list' },
            { text: 'ink-input-dispatcher', link: '/packages/core/ink-input-dispatcher' },
            { text: 'ink-split-pane', link: '/packages/core/ink-split-pane' },
          ],
        },
        {
          text: 'Data Display',
          items: [
            { text: 'ink-table', link: '/packages/data-display/ink-table' },
            { text: 'ink-chart', link: '/packages/data-display/ink-chart' },
            { text: 'ink-gauge', link: '/packages/data-display/ink-gauge' },
            { text: 'ink-tree', link: '/packages/data-display/ink-tree' },
            { text: 'ink-log-viewer', link: '/packages/data-display/ink-log-viewer' },
            { text: 'ink-markdown', link: '/packages/data-display/ink-markdown' },
            { text: 'ink-pager', link: '/packages/data-display/ink-pager' },
            { text: 'ink-diff', link: '/packages/data-display/ink-diff' },
            { text: 'ink-timeline', link: '/packages/data-display/ink-timeline' },
            { text: 'ink-pipeline', link: '/packages/data-display/ink-pipeline' },
          ],
        },
        {
          text: 'Input',
          items: [
            { text: 'ink-fuzzy-select', link: '/packages/input/ink-fuzzy-select' },
            { text: 'ink-textarea', link: '/packages/input/ink-textarea' },
            { text: 'ink-file-picker', link: '/packages/input/ink-file-picker' },
            { text: 'ink-masked-input', link: '/packages/input/ink-masked-input' },
            { text: 'ink-form', link: '/packages/input/ink-form' },
            { text: 'ink-checkbox', link: '/packages/input/ink-checkbox' },
            { text: 'ink-switch', link: '/packages/input/ink-switch' },
            { text: 'ink-radio', link: '/packages/input/ink-radio' },
          ],
        },
        {
          text: 'UI Chrome',
          items: [
            { text: 'ink-status-bar', link: '/packages/ui-chrome/ink-status-bar' },
            { text: 'ink-modal', link: '/packages/ui-chrome/ink-modal' },
            { text: 'ink-toast', link: '/packages/ui-chrome/ink-toast' },
            { text: 'ink-keybinding-help', link: '/packages/ui-chrome/ink-keybinding-help' },
            { text: 'ink-task-list', link: '/packages/ui-chrome/ink-task-list' },
            { text: 'ink-tabs', link: '/packages/ui-chrome/ink-tabs' },
            { text: 'ink-breadcrumb', link: '/packages/ui-chrome/ink-breadcrumb' },
            { text: 'ink-rule', link: '/packages/ui-chrome/ink-rule' },
          ],
        },
      ],
    },
    socialLinks: [
      { icon: 'github', link: 'https://github.com/wrxck/fleet' },
    ],
    footer: {
      message: 'Released under the MIT Licence.',
      copyright: 'Copyright 2026 Matt Hesketh',
    },
    search: {
      provider: 'local',
    },
  },
});
