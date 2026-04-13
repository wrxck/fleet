import { describe, it, expect } from 'vitest';

import {
  FleetError,
  AppNotFoundError,
  ServiceError,
  SecretsError,
  VaultNotInitializedError,
  GitError,
} from './errors.js';

describe('FleetError', () => {
  it('is an instance of Error', () => {
    const e = new FleetError('boom');
    expect(e).toBeInstanceOf(Error);
  });

  it('has name FleetError', () => {
    expect(new FleetError('x').name).toBe('FleetError');
  });

  it('stores message', () => {
    expect(new FleetError('test message').message).toBe('test message');
  });

  it('defaults exitCode to 1', () => {
    expect(new FleetError('x').exitCode).toBe(1);
  });

  it('accepts custom exitCode', () => {
    expect(new FleetError('x', 2).exitCode).toBe(2);
  });
});

describe('AppNotFoundError', () => {
  it('extends FleetError', () => {
    expect(new AppNotFoundError('myapp')).toBeInstanceOf(FleetError);
  });

  it('has name AppNotFoundError', () => {
    expect(new AppNotFoundError('myapp').name).toBe('AppNotFoundError');
  });

  it('includes app name in message', () => {
    expect(new AppNotFoundError('myapp').message).toContain('myapp');
  });

  it('has exitCode 1', () => {
    expect(new AppNotFoundError('myapp').exitCode).toBe(1);
  });
});

describe('ServiceError', () => {
  it('extends FleetError', () => {
    expect(new ServiceError('failed', 'nginx')).toBeInstanceOf(FleetError);
  });

  it('has name ServiceError', () => {
    expect(new ServiceError('msg', 'svc').name).toBe('ServiceError');
  });

  it('stores service name', () => {
    expect(new ServiceError('msg', 'nginx').service).toBe('nginx');
  });

  it('stores message', () => {
    expect(new ServiceError('service failed', 'nginx').message).toBe('service failed');
  });
});

describe('SecretsError', () => {
  it('extends FleetError', () => {
    expect(new SecretsError('vault error')).toBeInstanceOf(FleetError);
  });

  it('has name SecretsError', () => {
    expect(new SecretsError('x').name).toBe('SecretsError');
  });
});

describe('VaultNotInitializedError', () => {
  it('extends SecretsError', () => {
    expect(new VaultNotInitializedError()).toBeInstanceOf(SecretsError);
  });

  it('extends FleetError', () => {
    expect(new VaultNotInitializedError()).toBeInstanceOf(FleetError);
  });

  it('has name VaultNotInitializedError', () => {
    expect(new VaultNotInitializedError().name).toBe('VaultNotInitializedError');
  });

  it('has descriptive message with init instructions', () => {
    const e = new VaultNotInitializedError();
    expect(e.message).toContain('Vault not initialized');
    expect(e.message).toContain('fleet secrets init');
  });
});

describe('GitError', () => {
  it('extends FleetError', () => {
    expect(new GitError('git failure')).toBeInstanceOf(FleetError);
  });

  it('has name GitError', () => {
    expect(new GitError('x').name).toBe('GitError');
  });

  it('stores message', () => {
    expect(new GitError('failed to push').message).toBe('failed to push');
  });
});

describe('error hierarchy', () => {
  it('all errors are catchable as Error', () => {
    const errors = [
      new FleetError('x'),
      new AppNotFoundError('app'),
      new ServiceError('msg', 'svc'),
      new SecretsError('x'),
      new VaultNotInitializedError(),
      new GitError('x'),
    ];
    for (const e of errors) {
      expect(e).toBeInstanceOf(Error);
    }
  });

  it('all errors are catchable as FleetError', () => {
    const errors = [
      new AppNotFoundError('app'),
      new ServiceError('msg', 'svc'),
      new SecretsError('x'),
      new VaultNotInitializedError(),
      new GitError('x'),
    ];
    for (const e of errors) {
      expect(e).toBeInstanceOf(FleetError);
    }
  });
});
