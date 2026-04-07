import React from 'react';
import { render } from 'ink-testing-library';
import { describe, it, expect } from 'vitest';

import { Tabs } from '../src/tabs.js';

const BOX_VERTICAL = String.fromCharCode(0x2502);
const BOX_HORIZONTAL = String.fromCharCode(0x2500);

const sampleTabs = [
  { id: 'home', label: 'Home' },
  { id: 'logs', label: 'Logs' },
  { id: 'settings', label: 'Settings' },
];

describe('Tabs', () => {
  it('renders tabs with active highlighted', () => {
    const { lastFrame } = render(<Tabs tabs={sampleTabs} activeId="home" />);
    const frame = lastFrame()!;
    expect(frame).toContain('Home');
    expect(frame).toContain('Logs');
    expect(frame).toContain('Settings');
    // active tab should have underline indicator
    expect(frame).toContain(BOX_HORIZONTAL.repeat('Home'.length));
  });

  it('shows badge after label', () => {
    const tabs = [
      { id: 'alerts', label: 'Alerts', badge: 5 },
      { id: 'info', label: 'Info' },
    ];
    const { lastFrame } = render(<Tabs tabs={tabs} activeId="alerts" />);
    const frame = lastFrame()!;
    expect(frame).toContain('(5)');
  });

  it('renders separator between tabs', () => {
    const { lastFrame } = render(<Tabs tabs={sampleTabs} activeId="home" />);
    const frame = lastFrame()!;
    expect(frame).toContain(BOX_VERTICAL);
  });

  it('uses custom separator', () => {
    const { lastFrame } = render(<Tabs tabs={sampleTabs} activeId="home" separator=" | " />);
    const frame = lastFrame()!;
    expect(frame).toContain('|');
  });

  it('shows string badges', () => {
    const tabs = [
      { id: 'mail', label: 'Mail', badge: 'new' },
    ];
    const { lastFrame } = render(<Tabs tabs={tabs} activeId="mail" />);
    const frame = lastFrame()!;
    expect(frame).toContain('(new)');
  });

  it('renders with custom accentColor', () => {
    const { lastFrame } = render(<Tabs tabs={sampleTabs} activeId="home" accentColor="green" />);
    const frame = lastFrame()!;
    expect(frame).toContain('Home');
    expect(frame).toContain(BOX_HORIZONTAL.repeat('Home'.length));
  });
});
