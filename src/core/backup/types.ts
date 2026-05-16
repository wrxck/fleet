export type Retention = {
  hourly?: number;
  daily?: number;
  weekly?: number;
  monthly?: number;
  yearly?: number;
};

export type Schedule =
  | 'hourly'
  | '*-*-* 00/3:00:00'
  | '*-*-* 00/6:00:00'
  | '*-*-* 00/12:00:00'
  | 'daily'
  | 'weekly';

export type DumpType = 'postgres' | 'mysql' | 'mongo' | 'redis';

export interface DumpHook {
  type: DumpType;
  container: string;
  /** for postgres/mysql: database name. for mongo: optional db filter. for redis: ignored. */
  db?: string;
  /** literal user value passed to the dump tool. takes precedence over userEnv.
   *  defaults sensibly per type (postgres: $POSTGRES_USER, mysql: root, mongo: root). */
  user?: string;
  /** port the db listens on inside the container. only used for redis (which
   *  has a default of 6379 but glitchtip et al re-bind to non-standard ports). */
  port?: number;
  /** path inside the container that holds the password (docker secrets pattern).
   *  preferred over passwordEnv because shared-* containers use _FILE secrets. */
  passwordFile?: string;
  /** shell command executed on the HOST (outside the container) whose stdout
   *  becomes the password. used when the secret lives in a host .env file that
   *  was consumed by docker-compose at startup but is no longer present in
   *  the container. fleet runs as root so it can read those files. */
  passwordHostCommand?: string;
  /** env var name in the container that holds the user. legacy. */
  userEnv?: string;
  /** env var name in the container that holds the password. legacy. */
  passwordEnv?: string;
}

export interface AppBackupConfig {
  /** the app name as known to fleet (or `system`, `root-home`, `user-home` for pseudo-apps). */
  app: string;
  /** systemd OnCalendar expression. */
  schedule: Schedule;
  /** filesystem paths to include. */
  paths: string[];
  /** glob patterns to exclude. */
  exclude: string[];
  /** named docker volumes to dump alongside fs paths. */
  volumes?: string[];
  /** db dump to run before snapshot. */
  preDump?: DumpHook;
  /** post-snapshot cmd to run inside the host (rare). */
  postHook?: string;
  /** retention policy applied after every snapshot via restic forget --prune. */
  retention: Retention;
  /** disable: skip this app entirely. */
  disabled?: boolean;
}

export interface SnapshotInfo {
  id: string;
  shortId: string;
  time: string;
  hostname: string;
  paths: string[];
  tags: string[];
  sizeBytes?: number;
}

export interface RepoStats {
  totalSize: number;
  totalFileCount: number;
  snapshotCount: number;
}

export const PSEUDO_APPS = [
  'system', 'root-home', 'user-home',
  'shared-postgres', 'shared-mysql', 'shared-mongodb',
] as const;
export type PseudoApp = typeof PSEUDO_APPS[number];

export function isPseudoApp(name: string): name is PseudoApp {
  return (PSEUDO_APPS as readonly string[]).includes(name);
}
