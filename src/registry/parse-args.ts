import { z } from 'zod';

export type ParseResult =
  | { help: true }
  | { help: false; ok: true; values: Record<string, unknown> }
  | { help: false; ok: false; error: string };

/** single-dash short flags, mapped to the long-form (schema) field they set.
 *  short flags only ever set a boolean field true. */
const SHORT_FLAGS: Record<string, string> = { y: 'yes' };

/** true when a schema field (unwrapping optional/default) is a boolean. */
function isBooleanField(schema: z.ZodTypeAny): boolean {
  let s: z.ZodTypeAny = schema;
  while (s instanceof z.ZodOptional || s instanceof z.ZodDefault) {
    s = s._def.innerType as z.ZodTypeAny;
  }
  return s instanceof z.ZodBoolean;
}

export function parseArgs(schema: z.ZodObject<z.ZodRawShape>, argv: string[]): ParseResult {
  if (argv.includes('--help') || argv.includes('-h')) {
    return { help: true };
  }

  const shape = schema.shape;
  const fieldNames = Object.keys(shape);
  const booleanFields = new Set(fieldNames.filter(n => isBooleanField(shape[n])));

  const values: Record<string, unknown> = {};
  const positionals: string[] = [];

  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token.startsWith('--')) {
      const body = token.slice(2);
      const eq = body.indexOf('=');
      if (eq !== -1) {
        // --key=value form
        values[body.slice(0, eq)] = body.slice(eq + 1);
        continue;
      }
      if (booleanFields.has(body)) {
        values[body] = true;
        continue;
      }
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) {
        return { help: false, ok: false, error: `flag --${body} requires a value` };
      }
      values[body] = next;
      i++;
    } else if (/^-[A-Za-z]$/.test(token)) {
      // single-dash short flag (e.g. -y) — resolve via the alias table
      const long = SHORT_FLAGS[token.slice(1)];
      if (long === undefined || !(long in shape)) {
        return { help: false, ok: false, error: `unknown flag: ${token}` };
      }
      values[long] = true;
    } else {
      positionals.push(token);
    }
  }

  // reject flags that aren't in the schema — a mistyped flag must not be dropped silently
  const unknownFlags = Object.keys(values).filter(k => !(k in shape));
  if (unknownFlags.length > 0) {
    return { help: false, ok: false, error: `unknown flag(s): ${unknownFlags.join(', ')}` };
  }

  // assign leftover positionals to non-boolean fields in declaration order
  const positionalFields = fieldNames.filter(n => !booleanFields.has(n) && !(n in values));
  for (let i = 0; i < positionals.length && i < positionalFields.length; i++) {
    values[positionalFields[i]] = positionals[i];
  }

  const parsed = schema.safeParse(values);
  if (!parsed.success) {
    return {
      help: false,
      ok: false,
      error: parsed.error.issues.map(iss => `${iss.path.join('.')}: ${iss.message}`).join('; '),
    };
  }
  return { help: false, ok: true, values: parsed.data };
}
