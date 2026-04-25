import { useState, useEffect, useCallback, useRef } from 'react';
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
  const [results, setResults] = useState<HealthResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const initialised = useRef(false);
  // Cache last serialised payload so we can short-circuit setResults when
  // nothing changed. This kills the flicker that was happening on every
  // poll because React was re-rendering the whole list with identical data.
  const lastSerialised = useRef<string>('');

  const refresh = useCallback(() => {
    if (!initialised.current) setLoading(true);
    runFleetJson<HealthResult[]>(['health']).then(data => {
      initialised.current = true;
      if (data) {
        const serialised = JSON.stringify(data);
        if (serialised !== lastSerialised.current) {
          lastSerialised.current = serialised;
          setResults(data);
        }
        setError(null);
      } else {
        setError('Failed to fetch health data');
      }
      setLoading(false);
    });
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useInterval(refresh, autoRefreshMs);

  return { results, loading, error, refresh };
}
