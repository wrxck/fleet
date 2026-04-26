import { useState, useEffect, useCallback, useRef } from 'react';
import { useStableState } from '@matthesketh/ink-stable-state';
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
  // useStableState short-circuits setStatus when the polled payload is
  // structurally equal to the previous one — no flicker on identical refreshes.
  const [status, setStatus] = useStableState<StatusData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const initialised = useRef(false);

  const refresh = useCallback(() => {
    // Only show loading spinner on the very first fetch
    if (!initialised.current) setLoading(true);
    runFleetJson<StatusData>(['status']).then(data => {
      initialised.current = true;
      if (data) {
        setStatus(data);
        setError(null);
      } else {
        setError('Failed to fetch status');
      }
      setLoading(false);
    });
  }, [setStatus]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useInterval(refresh, autoRefreshMs);

  return { status, loading, error, refresh };
}
