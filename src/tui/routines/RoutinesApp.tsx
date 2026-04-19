import React, { useMemo, useState } from 'react';

import { Box, Text } from 'ink';
import { Tabs } from '@matthesketh/ink-tabs';
import { Modal } from '@matthesketh/ink-modal';
import { useRegisterHandler } from '@matthesketh/ink-input-dispatcher';

import type { AppEntry, Registry } from '../../core/registry.js';
import type { Routine } from '../../core/routines/schema.js';
import type { RoutinesRuntime } from './runtime.js';
import { DashboardTab } from './tabs/DashboardTab.js';
import { GitTab } from './tabs/GitTab.js';
import { RepoDetailView } from './tabs/RepoDetailView.js';
import { RoutinesTab } from './tabs/RoutinesTab.js';
import { RoutineForm } from './components/RoutineForm.js';
import { CommandPalette, type PaletteAction } from './components/CommandPalette.js';
import { LiveRunPanel } from './components/LiveRunPanel.js';
import { useSignals } from './hooks/use-signals.js';

type ActiveTab = 'dashboard' | 'routines' | 'git' | 'repo-detail';
type Modal =
  | null
  | { kind: 'form'; initial?: Routine }
  | { kind: 'delete'; id: string }
  | { kind: 'palette' }
  | { kind: 'live-run'; routineId: string };

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
  const [focusedRepo, setFocusedRepo] = useState<string | null>(null);
  const [modal, setModal] = useState<Modal>(null);
  const [routinesVersion, setRoutinesVersion] = useState(0);

  const targets = useMemo(() => targetsForRegistry(registry.apps), [registry]);
  const { snapshot, loading, lastRefreshed, refresh } = useSignals(runtime.collector, targets, 30_000);

  const routines = useMemo(() => {
    void routinesVersion;
    runtime.store.reload();
    return runtime.store.list();
  }, [runtime.store, routinesVersion]);

  const dashboardRows = useMemo(
    () => targets.map(t => ({ repo: t.repoName, signals: snapshot.get(t.repoName) ?? [] })),
    [targets, snapshot],
  );

  const bump = (): void => setRoutinesVersion(v => v + 1);

  const handleFormSubmit = async (routine: Routine): Promise<void> => {
    await runtime.engine.register(routine);
    setModal(null);
    bump();
  };

  const handleDelete = async (id: string): Promise<void> => {
    await runtime.engine.unregister(id);
    setModal(null);
    setRoutinesIndex(i => Math.max(0, Math.min(i, routines.length - 2)));
    bump();
  };

  const paletteActions: PaletteAction[] = useMemo(() => {
    const items: PaletteAction[] = [
      { id: 'nav:dashboard', group: 'nav', label: 'go to Dashboard' },
      { id: 'nav:routines', group: 'nav', label: 'go to Routines' },
      { id: 'action:refresh', group: 'action', label: 'refresh signals now' },
      { id: 'action:new', group: 'action', label: 'new routine…' },
    ];
    for (const r of routines) {
      items.push({ id: `routine:run:${r.id}`, group: 'routine', label: `run "${r.id}" now` });
      items.push({ id: `routine:edit:${r.id}`, group: 'routine', label: `edit "${r.id}"` });
      items.push({
        id: `routine:toggle:${r.id}`,
        group: 'routine',
        label: r.enabled ? `disable "${r.id}"` : `enable "${r.id}"`,
      });
    }
    for (const app of registry.apps) {
      items.push({ id: `repo:${app.name}`, group: 'repo', label: `focus repo "${app.name}"` });
    }
    return items;
  }, [routines, registry]);

  const handlePalette = async (action: PaletteAction): Promise<void> => {
    setModal(null);
    if (action.id === 'nav:dashboard') { setActiveTab('dashboard'); return; }
    if (action.id === 'nav:routines') { setActiveTab('routines'); return; }
    if (action.id === 'action:refresh') { await refresh(true); return; }
    if (action.id === 'action:new') { setModal({ kind: 'form' }); return; }
    if (action.id.startsWith('routine:run:')) {
      const id = action.id.slice('routine:run:'.length);
      setActiveTab('routines');
      setModal({ kind: 'live-run', routineId: id });
      return;
    }
    if (action.id.startsWith('routine:edit:')) {
      const id = action.id.slice('routine:edit:'.length);
      const r = runtime.store.get(id);
      if (r) setModal({ kind: 'form', initial: r });
      return;
    }
    if (action.id.startsWith('routine:toggle:')) {
      const id = action.id.slice('routine:toggle:'.length);
      const r = runtime.store.get(id);
      if (r) await runtime.engine.register({ ...r, enabled: !r.enabled });
      bump();
      return;
    }
    if (action.id.startsWith('repo:')) {
      const repo = action.id.slice('repo:'.length);
      setFocusedRepo(repo);
      setActiveTab('repo-detail');
    }
  };

  useRegisterHandler((input, key) => {
    if (modal?.kind === 'palette') return false;
    if (modal) return false;

    if (input === 'p' || (key.ctrl && input === 'k')) {
      setModal({ kind: 'palette' });
      return true;
    }
    if (input === '1') { setActiveTab('dashboard'); return true; }
    if (input === '2') { setActiveTab('routines'); setRoutinesDetail(false); return true; }
    if (input === '3') { setActiveTab('git'); return true; }

    if (activeTab === 'repo-detail') {
      if (key.escape) { setActiveTab('dashboard'); setFocusedRepo(null); return true; }
      if (input === 'a') {
        const nightly = runtime.store.get('nightly-audit');
        if (nightly) setModal({ kind: 'live-run', routineId: nightly.id });
        return true;
      }
      return false;
    }

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
      if (key.return && dashboardRows[dashboardIndex]) {
        setFocusedRepo(dashboardRows[dashboardIndex].repo);
        setActiveTab('repo-detail');
        return true;
      }
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

      const selected = routines[routinesIndex];
      if (input === 'n') { setModal({ kind: 'form' }); return true; }
      if (input === 'e' && selected) { setModal({ kind: 'form', initial: selected }); return true; }
      if (input === 'd' && selected) { setModal({ kind: 'delete', id: selected.id }); return true; }
      if (input === 't' && selected) {
        void runtime.engine.register({ ...selected, enabled: !selected.enabled }).then(bump);
        return true;
      }
      if (input === 'r' && selected) { setModal({ kind: 'live-run', routineId: selected.id }); return true; }
    }

    return false;
  });

  return (
    <Box flexDirection="column" paddingX={1}>
      <Tabs
        tabs={[
          { id: 'dashboard', label: '1  Dashboard', badge: dashboardRows.length },
          { id: 'routines', label: '2  Routines', badge: routines.length },
          { id: 'git', label: '3  Git' },
          ...(activeTab === 'repo-detail' ? [{ id: 'repo-detail', label: `◆  ${focusedRepo ?? ''}` }] : []),
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

      {activeTab === 'git' && <GitTab apps={registry.apps} />}

      {activeTab === 'repo-detail' && focusedRepo && (() => {
        const app = registry.apps.find(a => a.name === focusedRepo);
        return app
          ? <RepoDetailView app={app} />
          : <Text color="red">repo not found: {focusedRepo}</Text>;
      })()}

      <Box marginTop={1}>
        <Text color="gray">
          1 dash · 2 routines · 3 git · p palette · j/k move · enter drill · n new · e edit · d del · t toggle · r run · Esc back · q quit
        </Text>
      </Box>

      {modal?.kind === 'form' && (
        <RoutineForm
          initial={modal.initial}
          onSubmit={(r) => { void handleFormSubmit(r); }}
          onCancel={() => setModal(null)}
        />
      )}

      {modal?.kind === 'delete' && (
        <ConfirmDelete
          id={modal.id}
          onConfirm={() => { void handleDelete(modal.id); }}
          onCancel={() => setModal(null)}
        />
      )}

      {modal?.kind === 'palette' && (
        <CommandPalette
          actions={paletteActions}
          onSelect={(action) => { void handlePalette(action); }}
          onCancel={() => setModal(null)}
        />
      )}

      {modal?.kind === 'live-run' && (
        <LiveRunPanel
          engine={runtime.engine}
          routineId={modal.routineId}
          onClose={() => { setModal(null); bump(); }}
        />
      )}
    </Box>
  );
}

interface ConfirmDeleteProps { id: string; onConfirm(): void; onCancel(): void }

function ConfirmDelete({ id, onConfirm, onCancel }: ConfirmDeleteProps): React.JSX.Element {
  useRegisterHandler((input, key) => {
    if (input === 'y' || input === 'Y') { onConfirm(); return true; }
    if (input === 'n' || input === 'N' || key.escape) { onCancel(); return true; }
    return false;
  });
  return (
    <Box borderStyle="round" borderColor="red" paddingX={1} marginTop={1}>
      <Text>Delete routine <Text bold color="cyan">{id}</Text>? <Text color="green">y</Text> confirm   <Text color="red">n</Text> cancel</Text>
    </Box>
  );
}
