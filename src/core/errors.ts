export class FleetError extends Error {
  constructor(message: string, public exitCode = 1) {
    super(message);
    this.name = 'FleetError';
  }
}

// safely turn an unknown caught value into a message string. prefer this over
// `(e as Error).message` (which yields undefined when a non-Error is thrown —
// a string, a rejected non-error, etc.) and over the inline
// `e instanceof Error ? e.message : String(e)` idiom repeated across the tree.
export function messageOf(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export class AppNotFoundError extends FleetError {
  constructor(app: string) {
    super(`App not found: ${app}`);
    this.name = 'AppNotFoundError';
  }
}

export class ServiceError extends FleetError {
  constructor(message: string, public service: string) {
    super(message);
    this.name = 'ServiceError';
  }
}

export class SecretsError extends FleetError {
  constructor(message: string) {
    super(message);
    this.name = 'SecretsError';
  }
}

export class VaultNotInitializedError extends SecretsError {
  constructor() {
    super('Vault not initialized. Run: fleet secrets init');
    this.name = 'VaultNotInitializedError';
  }
}

export class GitError extends FleetError {
  constructor(message: string) {
    super(message);
    this.name = 'GitError';
  }
}
