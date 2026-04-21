import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { z } from 'zod';

import { RoutineSchema, type Routine } from './schema.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_STORE_PATH = join(__dirname, '..', '..', '..', 'data', 'routines.json');

const FileSchema = z.object({
  version: z.literal(1),
  routines: z.array(RoutineSchema),
  defaultsSeededAt: z.string().datetime().optional(),
});

export type RoutineStoreFile = z.infer<typeof FileSchema>;

function defaultFile(): RoutineStoreFile {
  return { version: 1, routines: [] };
}

function ensureDirFor(path: string): void {
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

export class RoutineStore {
  private file: RoutineStoreFile;

  constructor(private readonly path: string = DEFAULT_STORE_PATH) {
    this.file = this.readFromDisk();
  }

  private readFromDisk(): RoutineStoreFile {
    if (!existsSync(this.path)) return defaultFile();
    const raw = readFileSync(this.path, 'utf-8');
    try {
      return FileSchema.parse(JSON.parse(raw));
    } catch (err) {
      process.stderr.write(`[routines] Warning: failed to parse ${this.path}: ${String(err)}\n`);
      return defaultFile();
    }
  }

  private writeAtomic(): void {
    ensureDirFor(this.path);
    const tmp = `${this.path}.tmp.${process.pid}`;
    writeFileSync(tmp, JSON.stringify(this.file, null, 2) + '\n', { mode: 0o600 });
    renameSync(tmp, this.path);
  }

  list(): Routine[] {
    return [...this.file.routines];
  }

  get(id: string): Routine | null {
    return this.file.routines.find(r => r.id === id) ?? null;
  }

  upsert(routine: Routine): Routine {
    const validated = RoutineSchema.parse(routine);
    const now = new Date().toISOString();
    const idx = this.file.routines.findIndex(r => r.id === validated.id);
    const existing = idx >= 0 ? this.file.routines[idx] : null;
    const prepared: Routine = {
      ...validated,
      createdAt: existing?.createdAt ?? validated.createdAt ?? now,
      updatedAt: now,
    };
    if (idx >= 0) {
      this.file.routines[idx] = prepared;
    } else {
      this.file.routines.push(prepared);
    }
    this.writeAtomic();
    return prepared;
  }

  remove(id: string): boolean {
    const before = this.file.routines.length;
    this.file.routines = this.file.routines.filter(r => r.id !== id);
    const removed = this.file.routines.length !== before;
    if (removed) this.writeAtomic();
    return removed;
  }

  seedDefaults(routines: Routine[]): { seeded: number; skipped: number } {
    if (this.file.defaultsSeededAt) return { seeded: 0, skipped: routines.length };
    let seeded = 0;
    for (const r of routines) {
      if (!this.file.routines.some(existing => existing.id === r.id)) {
        this.file.routines.push(RoutineSchema.parse(r));
        seeded++;
      }
    }
    this.file.defaultsSeededAt = new Date().toISOString();
    this.writeAtomic();
    return { seeded, skipped: routines.length - seeded };
  }

  reload(): void {
    this.file = this.readFromDisk();
  }

  storePath(): string {
    return this.path;
  }
}
