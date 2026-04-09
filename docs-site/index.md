---
layout: home
hero:
  name: '@matthesketh/ink'
  text: 30 components for terminal UIs
  tagline: The most comprehensive component library for Ink. Build production-grade terminal applications with React.
  actions:
    - theme: brand
      text: Get Started
      link: /guide/getting-started
    - theme: alt
      text: View Components
      link: /packages/core/ink-viewport
features:
  - icon: "\u2328\uFE0F"
    title: Core
    details: Viewport management, scrollable lists, input routing, and split pane layouts. The foundation every Ink app needs.
    link: /packages/core/ink-viewport
  - icon: "\uD83D\uDCCA"
    title: Data Display
    details: Tables, charts, gauges, trees, diffs, timelines, markdown rendering, and more. 10 packages for showing data beautifully.
    link: /packages/data-display/ink-table
  - icon: "\u270D\uFE0F"
    title: Input
    details: Fuzzy select, textarea, file picker, masked input, forms, checkboxes, switches, and radio buttons. Every input you need.
    link: /packages/input/ink-fuzzy-select
  - icon: "\uD83C\uDFA8"
    title: UI Chrome
    details: Status bars, modals, toasts, keybinding help, task lists, tabs, breadcrumbs, and dividers. Polish your app's shell.
    link: /packages/ui-chrome/ink-status-bar
---

## Why @matthesketh/ink?

The Ink ecosystem is **top-heavy** — the core framework and a handful of official components are solid, but everything else is fragmented, outdated, or missing entirely. Most community packages target Ink 2.x or 3.x and are effectively abandoned.

**@matthesketh/ink** fills every gap with **30 production-tested packages** covering the full spectrum of terminal UI needs:

| Category | Packages | What's Covered |
|----------|:--------:|----------------|
| Core | 4 | Viewport, scrolling, input routing, split panes |
| Data Display | 10 | Tables, charts, gauges, trees, logs, markdown, diffs, timelines, pipelines, pager |
| Input | 8 | Fuzzy select, textarea, file picker, masked input, forms, checkbox, switch, radio |
| UI Chrome | 8 | Status bar, modal, toast, keybindings, task list, tabs, breadcrumb, divider |

All packages are:
- Built for **Ink 5** and **React 18**
- Written in **TypeScript** with full type declarations
- **Zero external dependencies** (except peer deps on ink + react)
- Tested with **496 tests** across the full suite
- Designed to work together via the **input dispatcher** pattern
