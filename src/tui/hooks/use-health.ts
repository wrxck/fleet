import { useState, useEffect, useCallback, useRef } from 'react';
import { useStableState } from '@matthesketh/ink-stable-state';
import { runFleetJson } from '../exec-bridge.js';
import { useInterval } from './use-interval.js';
import type { HealthResult } from '../../core/health.js';

interface HealthData {
  results: HealthResult[];
  loading: boolean;
  error: string | null;
  refresh: () => void;
}

export function useHealth(autoRefreshMs: number = 15_000): HealthData {
  // useStableState short-circuits setState when the new payload is structurally
  // equal to the previous one — no flicker on identical poll cycles.
  const [results, setResults] = useStableState<HealthResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const initialised = useRef(false);

  const refresh = useCallback(() => {
    if (!initialised.current) setLoading(true);
    runFleetJson<HealthResult[]>(['health']).then(data => {
      initialised.current = true;
      if (data) {
        setResults(data);
        setError(null);
      } else {
        setError('Failed to fetch health data');
      }
      setLoading(false);
    });
  }, [setResults]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useInterval(refresh, autoRefreshMs);

  return { results, loading, error, refresh };
}
