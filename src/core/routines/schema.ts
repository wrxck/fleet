import { z } from 'zod';

const ROUTINE_ID_REGEX = /^[a-z][a-z0-9-]{0,62}$/;
const NO_SHELL_META = /^[^`$;&|><\n\r\\"]*$/;

const DEFAULT_WALLCLOCK_MS = 15 * 60 * 1000;
const DEFAULT_TOKEN_CAP = 100_000;
const DEFAULT_MAX_USD = 5;

export const RoutineTaskSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('claude-cli'),
    prompt: z.string().min(1).max(8000),
    outputFormat: z.literal('json').default('json'),
    tokenCap: z.number().int().positive().max(1_000_000).default(DEFAULT_TOKEN_CAP),
    wallClockMs: z.number().int().positive().max(60 * 60 * 1000).default(DEFAULT_WALLCLOCK_MS),
    maxUsd: z.number().positive().max(100).default(DEFAULT_MAX_USD),
    model: z.string().optional(),
    appendSystem: z.string().max(2000).optional(),
    allowedTools: z.array(z.string().regex(/^[A-Za-z0-9_:*\-]+$/)).optional(),
  }),
  z.object({
    kind: z.literal('shell'),
    argv: z.array(z.string().min(1).regex(NO_SHELL_META)).min(1).max(64),
    env: z.record(z.string().regex(/^[A-Z_][A-Z0-9_]*$/), z.string()).optional(),
    wallClockMs: z.number().int().positive().max(60 * 60 * 1000).default(DEFAULT_WALLCLOCK_MS),
  }),
  z.object({
    kind: z.literal('mcp-call'),
    tool: z.string().regex(/^[a-z][a-z0-9_.-]*$/i),
    args: z.record(z.string(), z.unknown()).default({}),
    wallClockMs: z.number().int().positive().max(60 * 60 * 1000).default(DEFAULT_WALLCLOCK_MS),
  }),
]);

export type RoutineTask = z.infer<typeof RoutineTaskSchema>;

export const NotifyConfigSchema = z.object({
  kind: z.enum(['stdout', 'webhook', 'slack', 'email']),
  on: z.enum(['always', 'failure', 'success']).default('failure'),
  config: z.record(z.string(), z.unknown()).default({}),
});

export const RoutineScheduleSchema = z.union([
  z.object({ kind: z.literal('manual') }),
  z.object({
    kind: z.literal('calendar'),
    onCalendar: z.string().min(1).max(200),
    randomizedDelaySec: z.number().int().nonnegative().max(3600).default(0),
    persistent: z.boolean().default(true),
  }),
]);

export type RoutineSchedule = z.infer<typeof RoutineScheduleSchema>;

export const RoutineSchema = z.object({
  id: z.string().regex(ROUTINE_ID_REGEX, 'lowercase alphanumeric and dashes only'),
  name: z.string().min(1).max(100),
  description: z.string().max(2000).default(''),
  schedule: RoutineScheduleSchema,
  enabled: z.boolean().default(true),
  targets: z.array(z.string().min(1)).default([]),
  perTarget: z.boolean().default(false),
  task: RoutineTaskSchema,
  notify: z.array(NotifyConfigSchema).default([]),
  tags: z.array(z.string().max(32)).max(16).default([]),
  createdAt: z.string().datetime().optional(),
  updatedAt: z.string().datetime().optional(),
});

export type Routine = z.infer<typeof RoutineSchema>;

export const RunStatusSchema = z.enum(['queued', 'running', 'ok', 'failed', 'timeout', 'aborted']);
export type RunStatus = z.infer<typeof RunStatusSchema>;

export const RunEventSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('start'), routineId: z.string(), target: z.string().nullable(), at: z.string().datetime() }),
  z.object({ kind: z.literal('stdout'), chunk: z.string() }),
  z.object({ kind: z.literal('stderr'), chunk: z.string() }),
  z.object({ kind: z.literal('tool-call'), name: z.string(), argsPreview: z.string().max(500).optional() }),
  z.object({
    kind: z.literal('cost'),
    inputTokens: z.number().int().nonnegative(),
    outputTokens: z.number().int().nonnegative(),
    cacheCreateTokens: z.number().int().nonnegative().default(0),
    cacheReadTokens: z.number().int().nonnegative().default(0),
    usd: z.number().nonnegative(),
  }),
  z.object({
    kind: z.literal('end'),
    status: RunStatusSchema,
    exitCode: z.number().int(),
    durationMs: z.number().int().nonnegative(),
    at: z.string().datetime(),
    error: z.string().optional(),
  }),
]);

export type RunEvent = z.infer<typeof RunEventSchema>;

export const SignalKindSchema = z.enum([
  'git-clean',
  'git-ahead',
  'git-behind',
  'open-prs',
  'pr-age-max',
  'deps-outdated',
  'deps-vulns',
  'build-ok',
  'tests-ok',
  'env-schema-ok',
  'container-up',
  'ci-status',
  'cache-age',
]);

export type SignalKind = z.infer<typeof SignalKindSchema>;

export const SignalStateSchema = z.enum(['ok', 'warn', 'error', 'unknown']);
export type SignalState = z.infer<typeof SignalStateSchema>;

export const SignalSchema = z.object({
  repo: z.string(),
  kind: SignalKindSchema,
  state: SignalStateSchema,
  value: z.union([z.string(), z.number(), z.boolean(), z.null()]),
  detail: z.string().default(''),
  collectedAt: z.string().datetime(),
  ttlMs: z.number().int().nonnegative(),
});

export type Signal = z.infer<typeof SignalSchema>;

export function validateRoutine(input: unknown): Routine {
  return RoutineSchema.parse(input);
}

export function isExpired(signal: Signal, now = Date.now()): boolean {
  return new Date(signal.collectedAt).getTime() + signal.ttlMs <= now;
}
