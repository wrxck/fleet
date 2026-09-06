import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./fs-json.js', () => ({
  readJson: vi.fn(),
  writeJsonAtomic: vi.fn(),
}));

import { readJson, writeJsonAtomic } from './fs-json';
import {
  alertSignature,
  computeSignature,
  decideAlert,
  emptyState,
  formatAlert,
  loadState,
  pruneRestarts,
  recordRestart,
  remediate,
  saveState,
  selectRemediationTargets,
  type Failure,
  type WatchdogState,
} from './watchdog';

beforeEach(() => vi.clearAllMocks());

function makeFailure(overrides: Partial<Failure> = {}): Failure {
  return {
    app: 'macpool',
    serviceName: 'macpool',
    severity: 'down',
    reason: 'no running container (systemd: failed)',
    systemdFailed: true,
    remediable: true,
    ...overrides,
  };
}

function makeState(overrides: Partial<WatchdogState> = {}): WatchdogState {
  return { ...emptyState(), ...overrides };
}

describe('loadState', () => {
  it('returns an empty state when the file is missing', () => {
    vi.mocked(readJson).mockReturnValue(null);
    expect(loadState('/tmp/none.json')).toEqual(emptyState());
  });

  it('keeps well-formed persisted fields', () => {
    vi.mocked(readJson).mockReturnValue({
      lastSignature: 'down:macpool',
      lastAlertAt: '2026-09-06T12:00:00.000Z',
      restarts: { macpool: ['2026-09-06T11:00:00.000Z'] },
    });
    const s = loadState('/tmp/s.json');
    expect(s.lastSignature).toBe('down:macpool');
    expect(s.lastAlertAt).toBe('2026-09-06T12:00:00.000Z');
    expect(s.restarts.macpool).toEqual(['2026-09-06T11:00:00.000Z']);
  });

  it('discards a corrupt restarts map rather than trusting it', () => {
    vi.mocked(readJson).mockReturnValue({ restarts: { macpool: 'not-an-array' } });
    expect(loadState('/tmp/s.json').restarts).toEqual({});
  });

  it('discards non-string field types', () => {
    vi.mocked(readJson).mockReturnValue({ lastSignature: 42, lastAlertAt: {} });
    const s = loadState('/tmp/s.json');
    expect(s.lastSignature).toBe('');
    expect(s.lastAlertAt).toBeNull();
  });
});

describe('saveState', () => {
  it('writes through the atomic json helper', () => {
    const state = makeState({ lastSignature: 'x' });
    saveState(state, '/tmp/s.json');
    expect(writeJsonAtomic).toHaveBeenCalledWith('/tmp/s.json', state);
  });
});

describe('computeSignature', () => {
  it('is stable regardless of failure order', () => {
    const a = makeFailure({ app: 'a' });
    const b = makeFailure({ app: 'b', severity: 'degraded' });
    expect(computeSignature([a, b])).toBe(computeSignature([b, a]));
  });

  it('changes when an app changes severity', () => {
    const down = computeSignature([makeFailure({ severity: 'down' })]);
    const degraded = computeSignature([makeFailure({ severity: 'degraded' })]);
    expect(down).not.toBe(degraded);
  });

  it('is empty when nothing is failing', () => {
    expect(computeSignature([])).toBe('');
  });

  it('ignores the reason text, so a flapping message does not re-alert', () => {
    const a = computeSignature([makeFailure({ reason: 'one' })]);
    const b = computeSignature([makeFailure({ reason: 'two' })]);
    expect(a).toBe(b);
  });
});

describe('decideAlert', () => {
  const now = new Date('2026-09-06T12:00:00.000Z');

  it('alerts when the failure set changes', () => {
    const state = makeState({ lastSignature: 'down:a', lastAlertAt: now.toISOString() });
    expect(decideAlert(state, 'down:b', now)).toBe('changed');
  });

  it('suppresses an unchanged set inside the digest interval', () => {
    const state = makeState({ lastSignature: 'down:a', lastAlertAt: '2026-09-06T11:00:00.000Z' });
    expect(decideAlert(state, 'down:a', now)).toBe('suppress');
  });

  it('sends a digest once the interval has elapsed', () => {
    const state = makeState({ lastSignature: 'down:a', lastAlertAt: '2026-09-05T11:00:00.000Z' });
    expect(decideAlert(state, 'down:a', now)).toBe('digest');
  });

  it('reports recovery when the last alert had failures and now there are none', () => {
    const state = makeState({ lastSignature: 'down:a', lastAlertAt: now.toISOString() });
    expect(decideAlert(state, '', now)).toBe('recovered');
  });

  it('stays quiet when nothing was failing and nothing is failing', () => {
    expect(decideAlert(emptyState(), '', now)).toBe('suppress');
  });

  it('alerts when the stored timestamp is unparseable', () => {
    const state = makeState({ lastSignature: 'down:a', lastAlertAt: 'not-a-date' });
    expect(decideAlert(state, 'down:a', now)).toBe('changed');
  });

  it('honours a custom digest interval', () => {
    const state = makeState({ lastSignature: 'down:a', lastAlertAt: '2026-09-06T11:00:00.000Z' });
    expect(decideAlert(state, 'down:a', now, 30 * 60 * 1000)).toBe('digest');
  });
});

describe('pruneRestarts', () => {
  const now = new Date('2026-09-06T12:00:00.000Z');

  it('drops attempts older than the window', () => {
    const state = makeState({ restarts: { a: ['2026-09-06T10:00:00.000Z'] } });
    expect(pruneRestarts(state, now).restarts).toEqual({});
  });

  it('keeps attempts inside the window', () => {
    const recent = '2026-09-06T11:30:00.000Z';
    const state = makeState({ restarts: { a: [recent] } });
    expect(pruneRestarts(state, now).restarts).toEqual({ a: [recent] });
  });

  it('drops unparseable timestamps', () => {
    const state = makeState({ restarts: { a: ['nonsense'] } });
    expect(pruneRestarts(state, now).restarts).toEqual({});
  });

  it('leaves the rest of the state alone', () => {
    const state = makeState({ lastSignature: 'sig', restarts: {} });
    expect(pruneRestarts(state, now).lastSignature).toBe('sig');
  });
});

describe('selectRemediationTargets', () => {
  it('picks a down app whose unit systemd reports as failed', () => {
    const targets = selectRemediationTargets([makeFailure()], emptyState());
    expect(targets).toHaveLength(1);
  });

  it('never restarts a degraded app — it is still serving traffic', () => {
    const f = makeFailure({ severity: 'degraded' });
    expect(selectRemediationTargets([f], emptyState())).toHaveLength(0);
  });

  it('never restarts a unit that is merely inactive — that can be a deliberate stop', () => {
    const f = makeFailure({ systemdFailed: false });
    expect(selectRemediationTargets([f], emptyState())).toHaveLength(0);
  });

  it('never restarts an entry marked not remediable, such as the shared databases', () => {
    const f = makeFailure({ remediable: false });
    expect(selectRemediationTargets([f], emptyState())).toHaveLength(0);
  });

  it('stops once the per-window budget is spent', () => {
    const state = makeState({
      restarts: { macpool: ['2026-09-06T11:00:00.000Z', '2026-09-06T11:30:00.000Z'] },
    });
    expect(selectRemediationTargets([makeFailure()], state)).toHaveLength(0);
  });

  it('still allows a restart with one attempt used', () => {
    const state = makeState({ restarts: { macpool: ['2026-09-06T11:00:00.000Z'] } });
    expect(selectRemediationTargets([makeFailure()], state)).toHaveLength(1);
  });

  it('honours a custom budget', () => {
    expect(selectRemediationTargets([makeFailure()], emptyState(), 0)).toHaveLength(0);
  });
});

describe('recordRestart', () => {
  it('appends the attempt without dropping earlier ones', () => {
    const now = new Date('2026-09-06T12:00:00.000Z');
    const state = makeState({ restarts: { a: ['2026-09-06T11:00:00.000Z'] } });
    expect(recordRestart(state, 'a', now).restarts.a).toEqual([
      '2026-09-06T11:00:00.000Z',
      '2026-09-06T12:00:00.000Z',
    ]);
  });

  it('does not mutate the input state', () => {
    const state = makeState();
    recordRestart(state, 'a', new Date());
    expect(state.restarts).toEqual({});
  });
});

describe('remediate', () => {
  const now = new Date('2026-09-06T12:00:00.000Z');

  it('restarts an eligible app and records the attempt', () => {
    const restart = vi.fn(() => ({ ok: true }));
    const { state, outcomes } = remediate([makeFailure()], emptyState(), now, restart);
    expect(restart).toHaveBeenCalledWith('macpool');
    expect(outcomes).toEqual([
      { app: 'macpool', serviceName: 'macpool', ok: true, error: undefined, attempt: 1 },
    ]);
    expect(state.restarts.macpool).toHaveLength(1);
  });

  it('records a failed restart and keeps the error', () => {
    const restart = vi.fn(() => ({ ok: false, error: 'permission denied' }));
    const { outcomes } = remediate([makeFailure()], emptyState(), now, restart);
    expect(outcomes[0]).toMatchObject({ ok: false, error: 'permission denied' });
  });

  it('counts a failed attempt against the budget, so it cannot loop forever', () => {
    const restart = vi.fn(() => ({ ok: false, error: 'boom' }));
    let state = emptyState();
    for (let i = 0; i < 4; i++) {
      state = remediate([makeFailure()], state, now, restart).state;
    }
    expect(restart).toHaveBeenCalledTimes(2);
  });

  it('numbers attempts across separate runs', () => {
    const restart = vi.fn(() => ({ ok: true }));
    const first = remediate([makeFailure()], emptyState(), now, restart);
    const second = remediate([makeFailure()], first.state, now, restart);
    expect(second.outcomes[0].attempt).toBe(2);
  });

  it('records a throwing restart as a failed attempt instead of crashing the run', () => {
    const restart = vi.fn(() => { throw new Error('invalid service name'); });
    const { state, outcomes } = remediate([makeFailure()], emptyState(), now, restart);
    expect(outcomes[0]).toMatchObject({ ok: false, error: 'invalid service name' });
    expect(state.restarts.macpool).toHaveLength(1);
  });

  it('does nothing when no failure is eligible', () => {
    const restart = vi.fn(() => ({ ok: true }));
    const { outcomes } = remediate([makeFailure({ severity: 'degraded' })], emptyState(), now, restart);
    expect(restart).not.toHaveBeenCalled();
    expect(outcomes).toEqual([]);
  });
});

describe('alertSignature', () => {
  it('matches the failure signature when nothing was restarted', () => {
    const failures = [makeFailure()];
    expect(alertSignature(failures, [])).toBe(computeSignature(failures));
  });

  it('is non-empty when an app was restarted back to health', () => {
    const outcomes = [{ app: 'macpool', serviceName: 'macpool', ok: true, attempt: 1 }];
    expect(alertSignature([], outcomes)).not.toBe('');
  });

  it('changes between restart attempts, so a second attempt is reported', () => {
    const one = alertSignature([], [{ app: 'a', serviceName: 'a', ok: true, attempt: 1 }]);
    const two = alertSignature([], [{ app: 'a', serviceName: 'a', ok: true, attempt: 2 }]);
    expect(one).not.toBe(two);
  });
});

describe('formatAlert', () => {
  it('lists down apps under their own heading, above degraded ones', () => {
    const msg = formatAlert(
      'ubuntu',
      [makeFailure({ app: 'macpool' }), makeFailure({ app: 'blog', severity: 'degraded', reason: 'http check failed' })],
      [],
      'changed',
    );
    expect(msg).toContain('host: ubuntu');
    expect(msg).toContain('down: 1  degraded: 1');
    expect(msg.indexOf('DOWN')).toBeLessThan(msg.indexOf('degraded\n'));
    expect(msg).toContain('- macpool: no running container (systemd: failed)');
    expect(msg).toContain('- blog: http check failed');
  });

  it('marks a digest so the reader knows nothing changed', () => {
    const msg = formatAlert('ubuntu', [makeFailure()], [], 'digest');
    expect(msg).toContain('daily digest, unchanged');
  });

  it('reports recovery when the failure list is empty', () => {
    const msg = formatAlert('ubuntu', [], [], 'recovered');
    expect(msg).toContain('recovered');
    expect(msg).toContain('all services healthy');
  });

  it('appends restart outcomes to a recovery message', () => {
    const msg = formatAlert('ubuntu', [], [{ app: 'macpool', serviceName: 'macpool', ok: true, attempt: 1 }], 'changed');
    expect(msg).toContain('recovered');
    expect(msg).toContain('- macpool (attempt 1): restarted');
  });

  it('shows why a restart failed', () => {
    const msg = formatAlert(
      'ubuntu',
      [makeFailure()],
      [{ app: 'macpool', serviceName: 'macpool', ok: false, error: 'unit not found', attempt: 2 }],
      'changed',
    );
    expect(msg).toContain('- macpool (attempt 2): failed — unit not found');
  });
});
