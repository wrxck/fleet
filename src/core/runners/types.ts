// a registered remote build host. connection material is resolved from a host
// id so a routine task only ever carries a safe slug, never raw ssh details.
export interface RemoteHost {
  destination: string; // ssh destination: user@host, or an ssh_config alias
  port?: number;
  identityFile?: string; // private key fleet authenticates with
  defaultCwd?: string; // remote working dir used when a task omits one
}
