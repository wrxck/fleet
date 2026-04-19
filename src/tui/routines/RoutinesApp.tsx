import React, { useMemo, useState } from 'react';

import { Box, Text } from 'ink';
import { Tabs } from '@matthesketh/ink-tabs';
import { useRegisterHandler } from '@matthesketh/ink-input-dispatcher';

import type { AppEntry, Registry } from '../../core/registry.js';
import type { RoutinesRuntime } from './runtime.js';
import { DashboardTab } from './tabs/DashboardTab.js';
import { RoutinesTab } from './tabs/RoutinesTab.js';
import { useSignals } from './hooks/use-signals.js';

type ActiveTab = 'dashboard' | 'routines';

export interface RoutinesAppProps {
  runtime: RoutinesRuntime;
  registry: Registry;
}

function targetsForRegistry(apps: AppEntry[]): { repoName: string; repoPath: string }[] {
  return apps.map(a => ({
    repoName: a.name,
    repoPath: typeof a.composePath === 'string' && a.composePath ? a.composePath : '',
  }));
}

export function RoutinesApp({ runtime, registry }: RoutinesAppProps): React.JSX.Element {
  const [activeTab, setActiveTab] = useState<ActiveTab>('dashboard');
  const [dashboardIndex, setDashboardIndex] = useState(0);
  const [routinesIndex, setRoutinesIndex] = useState(0);
  const [routinesDetail, setRoutinesDetail] = useState(false);

  const targets = useMemo(() => targetsForRegistry(registry.apps), [registry]);
  const { snapshot, loading, lastRefreshed, refresh } = useSignals(runtime.collector, targets, 30_000);

  const routines = runtime.store.list();

  const dashboardRows = useMemo(
    () => targets.map(t => ({ repo: t.repoName, signals: snapshot.get(t.repoName) ?? [] })),
    [targets, snapshot],
  );

  useRegisterHandler((input, key) => {
    if (input === '1') { setActiveTab('dashboard'); return true; }
    if (input === '2') { setActiveTab('routines'); setRoutinesDetail(false); return true; }

    if (activeTab === 'dashboard') {
      if (input === 'j' || key.downArrow) {
        setDashboardIndex(i => Math.min(i + 1, Math.max(dashboardRows.length - 1, 0)));
        return true;
      }
      if (input === 'k' || key.upArrow) {
        setDashboardIndex(i => Math.max(i - 1, 0));
        return true;
      }
      if (input === 'r') { void refresh(true); return true; }
    }

    if (activeTab === 'routines') {
      if (input === 'j' || key.downArrow) {
        setRoutinesIndex(i => Math.min(i + 1, Math.max(routines.length - 1, 0)));
        return true;
      }
      if (input === 'k' || key.upArrow) {
        setRoutinesIndex(i => Math.max(i - 1, 0));
        return true;
      }
      if (key.return) { setRoutinesDetail(o => !o); return true; }
      if (key.escape) { setRoutinesDetail(false); return true; }
    }

    return false;
  });

  return (
    <Box flexDirection="column" paddingX={1}>
      <Tabs
        tabs={[
          { id: 'dashboard', label: '1  Dashboard', badge: dashboardRows.length },
          { id: 'routines', label: '2  Routines', badge: routines.length },
        ]}
        activeId={activeTab}
        accentColor="cyan"
      />

      {activeTab === 'dashboard' && (
        <DashboardTab
          rows={dashboardRows}
          selectedIndex={dashboardIndex}
          loading={loading}
          lastRefreshed={lastRefreshed}
          signalsByRepo={snapshot}
          seededNotice={runtime.seeded}
        />
      )}

      {activeTab === 'routines' && (
        <RoutinesTab
          engine={runtime.engine}
          routines={routines}
          selectedIndex={routinesIndex}
          detailOpen={routinesDetail}
        />
      )}

      <Box marginTop={1}>
        <Text color="gray">1 dashboard · 2 routines · j/k move · enter detail · r refresh · q quit</Text>
      </Box>
    </Box>
  );
}
