import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { parse } from 'yaml';

import type { AppEntry } from './registry';

export interface ComposeAnalysis {
  /** vars that hard-fail interpolation when unset: ${VAR:?msg} / ${VAR?msg} */
  strictRequiredVars: string[];
  /** bare interpolations with no default (${VAR} / $VAR) — empty when unset */
  bareVars: string[];
  /** vars with an inline default: ${VAR:-x} / ${VAR-x} (and :+/+ alternates) */
  defaultedVars: string[];
  /** strict + bare, deduped — everything the vault should cover */
  requiredVars: string[];
  /** env var names the docker build args pull from (interpolated values plus
   *  bare list/map form args, which docker fills from the environment) */
  buildArgVars: string[];
  /** explicit top-level compose project name, if any */
  projectName: string | null;
  /** host ports published by any service */
  hostPorts: number[];
  /** true when the yaml parse failed and only the raw-text var scan ran */
  yamlParseFailed: boolean;
}

// one pass over the raw text: the braced form (with optional operator) wins
// over the unbraced $VAR form at the same position because alternation is
// ordered. nested defaults (${A:-${B}}) stop at the first closing brace —
// acceptable for a checklist, the outer var still classifies correctly.
const VAR_REF_RE = /\$\{([A-Za-z_][A-Za-z0-9_]*)(?:(:-|-|:\?|\?|:\+|\+)([^}]*))?\}|\$([A-Za-z_][A-Za-z0-9_]*)/g;

function classifyRefs(raw: string): { strict: Set<string>; bare: Set<string>; defaulted: Set<string> } {
  // $$ escapes a literal dollar in compose — those are never interpolations.
  const cleaned = raw.replace(/\$\$/g, '');
  const strict = new Set<string>();
  const bare = new Set<string>();
  const defaulted = new Set<string>();

  for (const m of cleaned.matchAll(VAR_REF_RE)) {
    const name = m[1] ?? m[4];
    const op = m[1] ? m[2] : undefined;
    if (!name) continue;
    if (op === ':?' || op === '?') strict.add(name);
    else if (op) defaulted.add(name);
    else bare.add(name);
  }

  // precedence: strict > bare > defaulted — a var that is strictly required
  // anywhere in the file is required, whatever other forms it appears in.
  for (const v of strict) { bare.delete(v); defaulted.delete(v); }
  for (const v of bare) defaulted.delete(v);
  return { strict, bare, defaulted };
}

function extractValueRefs(value: string, into: Set<string>): void {
  const { strict, bare } = classifyRefs(value);
  // defaulted refs in a build arg have a fallback, so they don't need the vault
  for (const v of strict) into.add(v);
  for (const v of bare) into.add(v);
}

function collectHostPort(spec: unknown, into: number[]): void {
  if (typeof spec === 'string') {
    // short syntax: "8080:80", "127.0.0.1:8080:80", "8080:80/udp",
    // "8080-8090:80" (range: warn on the range start). a lone "80" publishes
    // to an ephemeral host port, which cannot clash deterministically — skip.
    const parts = spec.split('/')[0].split(':');
    if (parts.length < 2) return;
    const host = parseInt(parts[parts.length - 2], 10);
    if (!isNaN(host)) into.push(host);
  } else if (spec && typeof spec === 'object') {
    const published = (spec as Record<string, unknown>).published;
    const n = typeof published === 'number' ? published : parseInt(String(published ?? ''), 10);
    if (!isNaN(n)) into.push(n);
  }
}

function collectBuildArgVars(args: unknown, into: Set<string>): void {
  if (Array.isArray(args)) {
    for (const item of args) {
      if (typeof item !== 'string') continue;
      const eq = item.indexOf('=');
      // list form without a value pulls the var from the environment
      if (eq === -1) into.add(item.trim());
      else extractValueRefs(item.slice(eq + 1), into);
    }
  } else if (args && typeof args === 'object') {
    for (const [key, value] of Object.entries(args as Record<string, unknown>)) {
      // map form with a null value pulls the var from the environment
      if (value === null || value === undefined) into.add(key);
      else if (typeof value === 'string') extractValueRefs(value, into);
    }
  }
}

export function analyzeCompose(raw: string): ComposeAnalysis {
  const { strict, bare, defaulted } = classifyRefs(raw);
  const buildArgVars = new Set<string>();
  const hostPorts: number[] = [];
  let projectName: string | null = null;
  let yamlParseFailed = false;

  let doc: unknown = null;
  try {
    doc = parse(raw);
  } catch {
    yamlParseFailed = true;
  }

  if (doc && typeof doc === 'object') {
    const top = doc as Record<string, unknown>;
    if (typeof top.name === 'string') projectName = top.name;

    const services = (top.services && typeof top.services === 'object')
      ? Object.values(top.services as Record<string, unknown>)
      : [];
    for (const svc of services) {
      if (!svc || typeof svc !== 'object') continue;
      const s = svc as Record<string, unknown>;
      if (s.build && typeof s.build === 'object') {
        collectBuildArgVars((s.build as Record<string, unknown>).args, buildArgVars);
      }
      if (Array.isArray(s.ports)) {
        for (const p of s.ports) collectHostPort(p, hostPorts);
      }
    }
  }

  return {
    strictRequiredVars: [...strict].sort(),
    bareVars: [...bare].sort(),
    defaultedVars: [...defaulted].sort(),
    requiredVars: [...new Set([...strict, ...bare])].sort(),
    buildArgVars: [...buildArgVars].sort(),
    projectName,
    hostPorts,
    yamlParseFailed,
  };
}

/** the compose file the app's registry entry points at, whether or not it
 *  exists — callers use existsSync on the result for the compose check. */
export function resolveComposeFile(app: Pick<AppEntry, 'composePath' | 'composeFile'>): string {
  if (app.composeFile) return join(app.composePath, app.composeFile);
  for (const candidate of ['docker-compose.yml', 'docker-compose.yaml', 'compose.yml', 'compose.yaml']) {
    const p = join(app.composePath, candidate);
    if (existsSync(p)) return p;
  }
  return join(app.composePath, 'docker-compose.yml');
}

/** vars a deploy cannot survive without: strict interpolations fail compose
 *  outright, and build-arg vars are what the vault env feeds into the docker
 *  build (a missing one is the classic silent E401). bare ${VAR} refs resolve
 *  to empty rather than failing, so they warn instead of block. vars already
 *  present in the process environment are satisfied without the vault. */
export function deployBlockingVars(analysis: ComposeAnalysis): string[] {
  return [...new Set([...analysis.strictRequiredVars, ...analysis.buildArgVars])]
    .filter(v => process.env[v] === undefined)
    .sort();
}
