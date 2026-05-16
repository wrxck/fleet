import { z } from 'zod';

export type ParseResult =
  | { help: true }
  | { help: false; ok: true; values: Record<string, unknown> }
  | { help: false; ok: false; error: string };

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
      const key = token.slice(2);
      if (booleanFields.has(key)) {
        values[key] = true;
      } else {
        values[key] = argv[++i];
      }
    } else {
      positionals.push(token);
    }
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
