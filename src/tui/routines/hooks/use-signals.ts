import { useEffect, useRef, useState } from 'react';

import type { Signal } from '../../../core/routines/schema.js';
import type { SignalCollector, SignalTarget } from '../../../core/routines/signals-collector.js';

export interface UseSignalsResult {
  snapshot: Map<string, Signal[]>;
  loading: boolean;
  lastRefreshed: number;
  refresh(force?: boolean): Promise<void>;
}

export function useSignals(
  collector: SignalCollector,
  targets: SignalTarget[],
  intervalMs = 30_000,
): UseSignalsResult {
  const [snapshot, setSnapshot] = useState<Map<string, Signal[]>>(new Map());
  const [loading, setLoading] = useState(false);
  const [lastRefreshed, setLastRefreshed] = useState(0);
  const mounted = useRef(true);
  const targetsKey = targets.map(t => t.repoName).join('|');

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  useEffect(() => {
    let cancelled = false;

    const run = async (force = false): Promise<void> => {
      if (cancelled) return;
      setLoading(true);
      try {
        if (force) {
          await collector.collect(targets.map(target => ({ target, force: true })));
        } else {
          await collector.collect(targets.map(target => ({ target })));
        }
        if (cancelled || !mounted.current) return;
        const next = new Map<string, Signal[]>();
        for (const t of targets) next.set(t.repoName, collector.readCached(t.repoName));
        setSnapshot(next);
        setLastRefreshed(Date.now());
      } finally {
        if (mounted.current && !cancelled) setLoading(false);
      }
    };

    void run();
    const id = setInterval(() => void run(), intervalMs);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [collector, targetsKey, intervalMs]);

  const refresh = async (force = false): Promise<void> => {
    setLoading(true);
    try {
      await collector.collect(targets.map(target => ({ target, force })));
      const next = new Map<string, Signal[]>();
      for (const t of targets) next.set(t.repoName, collector.readCached(t.repoName));
      setSnapshot(next);
      setLastRefreshed(Date.now());
    } finally {
      setLoading(false);
    }
  };

  return { snapshot, loading, lastRefreshed, refresh };
}
