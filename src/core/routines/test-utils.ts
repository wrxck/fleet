import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const EXEC_TMP_ROOT = join(__dirname, '..', '..', '..', '.test-tmp');

export function mkExecTmpDir(prefix: string): string {
  if (!existsSync(EXEC_TMP_ROOT)) mkdirSync(EXEC_TMP_ROOT, { recursive: true });
  return mkdtempSync(join(EXEC_TMP_ROOT, prefix));
}

export function rmExecTmpDir(dir: string): void {
  rmSync(dir, { recursive: true, force: true });
}
