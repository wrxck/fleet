import type { SignalState } from '../../core/routines/schema.js';

export const signalStateColor: Record<SignalState, string> = {
  ok: 'green',
  warn: 'yellow',
  error: 'red',
  unknown: 'gray',
};

export const signalStateGlyph: Record<SignalState, string> = {
  ok: '●',
  warn: '◐',
  error: '●',
  unknown: '○',
};

export function formatRelative(iso: string | null, now = Date.now()): string {
  if (!iso) return '—';
  const ms = now - new Date(iso).getTime();
  const abs = Math.abs(ms);
  const suffix = ms >= 0 ? 'ago' : 'from now';
  if (abs < 10_000) return 'just now';
  if (abs < 60_000) return `${Math.round(abs / 1000)}s ${suffix}`;
  if (abs < 3_600_000) return `${Math.round(abs / 60_000)}m ${suffix}`;
  if (abs < 86_400_000) return `${Math.round(abs / 3_600_000)}h ${suffix}`;
  return `${Math.round(abs / 86_400_000)}d ${suffix}`;
}

export function formatDuration(ms: number | null): string {
  if (ms == null) return '—';
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`;
}

export function formatUsd(usd: number | null): string {
  if (usd == null) return '—';
  if (usd < 0.01) return `<$0.01`;
  if (usd < 1) return `$${usd.toFixed(3)}`;
  return `$${usd.toFixed(2)}`;
}

export function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max - 1)}…`;
}
