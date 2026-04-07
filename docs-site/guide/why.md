# Why @matthesketh/ink?

## The Problem

The Ink ecosystem is **top-heavy**. The core framework (`ink` at 2.6M downloads/week) and a handful of official components are well-maintained. But the broader ecosystem is severely fragmented:

- **Most community packages target Ink 2.x or 3.x** and are effectively abandoned
- **Critical primitives are missing** — no split panes, no diff viewer, no command palette
- **No input management solution** — every app reinvents keyboard routing, badly
- **@inkjs/ui** covers basics (TextInput, Select, Spinner) but lacks power-user components

Building a production TUI with Ink means cobbling together outdated packages, writing your own components from scratch, and fighting input handler conflicts.

## The Solution

**@matthesketh/ink** provides **30 packages** that cover the full spectrum of terminal UI needs. All built for Ink 5, all tested, all designed to work together.

## Comparison

### vs @inkjs/ui

| Feature | @inkjs/ui | @matthesketh/ink |
|---------|-----------|-----------------|
| Text Input | Yes | Yes (+ textarea, masked input) |
| Select | Yes | Yes (+ fuzzy select, radio) |
| Multi-Select | Yes | Yes (+ checkbox) |
| Spinner | Yes | Yes (via ink-spinner) |
| Progress Bar | Yes | Yes (+ gauge, donut) |
| Table | No | Yes |
| Charts | No | Yes (sparkline, bar, line) |
| Tree View | No | Yes |
| Split Pane | No | Yes |
| Diff Viewer | No | Yes |
| Input Routing | No | Yes |
| Modal | No | Yes |
| Toast | No | Yes |
| File Picker | No | Yes |
| Form Builder | No | Yes |
| **Total Components** | **~12** | **30** |

### vs Textual (Python)

Textual has 37 built-in widgets and is the gold standard for modern TUI frameworks. @matthesketh/ink covers equivalent ground in the areas that matter for CLI applications:

- Textual has: Checkbox, RadioButton, Switch, Select, Input, TextArea, DataTable, Tree, Markdown, Footer, Header, Tabs, ProgressBar, Sparkline, LoadingIndicator, DirectoryTree, RichLog
- @matthesketh/ink has all of the above equivalents, **plus**: Split Pane, Diff Viewer, Fuzzy Select, Pipeline, Timeline, Gauge/Donut, Charts, File Picker, Modal, Toast, Keybinding Help, Pager, Log Viewer, Masked Input, Form Builder

### vs blessed / blessed-contrib

blessed is unmaintained but blessed-contrib has dashboard widgets (charts, gauges, maps) that Ink lacked. @matthesketh/ink now covers charts, gauges, trees, and log viewers — the core dashboard primitives.

### vs Bubbletea (Go)

Bubbletea's Bubbles library has ~13 components. @matthesketh/ink covers all of them and adds 17 more. The Go ecosystem has better input management via the Elm architecture; @matthesketh/ink-input-dispatcher brings equivalent clean input routing to React/Ink.

## Design Principles

1. **Zero external dependencies** — only peer deps on ink + react. No dependency tree bloat.
2. **Presentational by default** — most components are controlled. Parent manages state, component renders it. No hidden side effects.
3. **Input dispatcher pattern** — one `useInput` at the root. Views register handlers. No conflicts.
4. **TypeScript-first** — full type declarations, generic components where appropriate.
5. **Tested** — 496 tests across the suite. Edge cases, boundary conditions, interaction tests.
