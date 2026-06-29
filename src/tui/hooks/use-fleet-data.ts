import { useState, useEffect, useCallback, useRef } from 'react';
import { useStableState } from '@matthesketh/ink-stable-state';

import { runFleetJson } from '../exec-bridge';
import { useInterval } from './use-interval';
import { messageOf } from '../../core/errors';
import type { StatusData } from '../../commands/status';

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
  // guard against setState after unmount: the tui can tear a view down while a
  // poll is still in flight.
  const mounted = useRef(true);

  const refresh = useCallback(() => {
    // only show the loading spinner on the very first fetch.
    if (!initialised.current) setLoading(true);
    runFleetJson<StatusData>(['status']).then(data => {
      if (!mounted.current) return;
      initialised.current = true;
      if (data) {
        setStatus(data);
        setError(null);
      } else {
        setError('Failed to fetch status');
      }
      setLoading(false);
    }).catch((err: unknown) => {
      // a rejected poll (spawn failure, killed process) must not become an
      // unhandled rejection; surface it as an error state instead.
      if (!mounted.current) return;
      initialised.current = true;
      setError(messageOf(err));
      setLoading(false);
    });
  }, [setStatus]);

  useEffect(() => {
    mounted.current = true;
    refresh();
    return () => { mounted.current = false; };
  }, [refresh]);

  useInterval(refresh, autoRefreshMs);

  return { status, loading, error, refresh };
}
