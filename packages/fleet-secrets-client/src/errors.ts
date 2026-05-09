export class FleetSecretsError extends Error {
  readonly code: string;
  constructor(message: string, code: string = 'fleet_secrets_error') {
    super(message);
    this.name = 'FleetSecretsError';
    this.code = code;
  }
}
