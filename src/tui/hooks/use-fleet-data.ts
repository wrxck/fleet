import { useState, useEffect, useCallback, useRef } from 'react';
import { runFleetJson } from '../exec-bridge.js';
import { useInterval } from './use-interval.js';
import type { StatusData } from '../../commands/status.js';

interface FleetData {
  status: StatusData | null;
  loading: boolean;
  error: string | null;
  refresh: () => void;
}

export function useFleetData(autoRefreshMs: number = 10_000): FleetData {
  const [status, setStatus] = useState<StatusData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const initialised = useRef(false);
  // Cache the last serialised payload so we can short-circuit setStatus
  // when nothing changed — kills the every-10s flicker caused by React
  // re-rendering with identical data.
  const lastSerialised = useRef<string>('');

  const refresh = useCallback(() => {
    // Only show loading spinner on the very first fetch
    if (!initialised.current) setLoading(true);
    runFleetJson<StatusData>(['status']).then(data => {
      initialised.current = true;
      if (data) {
        const serialised = JSON.stringify(data);
        if (serialised !== lastSerialised.current) {
          lastSerialised.current = serialised;
          setStatus(data);
        }
        setError(null);
      } else {
        setError('Failed to fetch status');
      }
      setLoading(false);
    });
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useInterval(refresh, autoRefreshMs);

  return { status, loading, error, refresh };
}
