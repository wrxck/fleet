import { describe, it, expect, vi, beforeEach } from 'vitest';

import { serviceCommand } from './service';
import { installServiceForApp } from '../core/service-install';
import { success, error } from '../ui/output';

vi.mock('../core/service-install.js', () => ({
  installServiceForApp: vi.fn(),
}));

vi.mock('../ui/output.js', () => ({
  success: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
}));

const mockInstall = vi.mocked(installServiceForApp);
const mockSuccess = vi.mocked(success);
const mockError = vi.mocked(error);

beforeEach(() => {
  vi.clearAllMocks();
  mockInstall.mockReturnValue({ ok: true, message: 'installed staging.service and enabled it at boot', unit: '[Unit]' });
});

describe('serviceCommand — usage', () => {
  it('exits on an unknown subcommand', async () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    await expect(serviceCommand(['uninstall', 'x'])).rejects.toThrow('exit');
    expect(mockError).toHaveBeenCalledWith(expect.stringMatching(/Usage: fleet service install/));
    exitSpy.mockRestore();
  });

  it('exits when no app name is given', async () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    await expect(serviceCommand(['install'])).rejects.toThrow('exit');
    expect(mockInstall).not.toHaveBeenCalled();
    exitSpy.mockRestore();
  });
});

describe('serviceCommand — install', () => {
  it('installs without force by default', async () => {
    await serviceCommand(['install', 'staging']);
    expect(mockInstall).toHaveBeenCalledWith('staging', { force: false });
    expect(mockSuccess).toHaveBeenCalledWith(expect.stringMatching(/installed staging\.service/));
  });

  it('passes force through', async () => {
    await serviceCommand(['install', 'staging', '--force']);
    expect(mockInstall).toHaveBeenCalledWith('staging', { force: true });
  });

  it('exits non-zero and prints the refusal when the core refuses', async () => {
    mockInstall.mockReturnValue({ ok: false, message: 'staging.service already exists — pass force to overwrite it.' });
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    await expect(serviceCommand(['install', 'staging'])).rejects.toThrow('exit');
    expect(mockError).toHaveBeenCalledWith(expect.stringMatching(/already exists/));
    expect(exitSpy).toHaveBeenCalledWith(1);
    exitSpy.mockRestore();
  });
});
