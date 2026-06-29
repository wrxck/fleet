// small shared helpers for the legacy imperative commands. the typed command
// registry (src/registry) parses args with zod; these cover the hand-parsed
// commands until they migrate onto it.

// return the token following `flag` in argv, or undefined when the flag is
// absent or has no value. e.g. extractFlag(['--app', 'web'], '--app') === 'web'.
export function extractFlag(args: string[], flag: string): string | undefined {
  const idx = args.indexOf(flag);
  if (idx === -1 || idx + 1 >= args.length) return undefined;
  return args[idx + 1];
}

// resolve after the given milliseconds. used by commands that poll an external
// resource (testflight builds, the mock server lifecycle).
export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
