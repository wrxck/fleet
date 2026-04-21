import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as registry from '../core/registry.js';
import * as exec from '../core/exec.js';
import * as systemd from '../core/systemd.js';
import { rollbackCommand } from './rollback.js';

vi.mock('../core/registry.js');
vi.mock('../core/exec.js');
vi.mock('../core/systemd.js');

const baseApp = {
  name: 'x',
  displayName: 'x',
  composePath: '/tmp/x',
  composeFile: null,
  serviceName: 'x-svc',
  domains: [],
  port: null,
  usesSharedDb: false,
  type: 'service' as const,
  containers: [],
  dependsOnDatabases: false,
  registeredAt: '',
};

function stubReg() {
  vi.mocked(registry.load).mockReturnValue({
    version: 1,
    apps: [baseApp],
    infrastructure: {
      databases: { serviceName: '', composePath: '' },
      nginx: { configPath: '' },
    },
  });
  vi.mocked(registry.findApp).mockImplementation((reg, name) =>
    reg.apps.find(a => a.name === name || a.serviceName === name)
  );
}

describe('rollbackCommand', () => {
  beforeEach(() => vi.resetAllMocks());

  it('exits 1 when no app arg', async () => {
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => { throw new Error('exit'); }) as never);
    await expect(rollbackCommand([])).rejects.toThrow('exit');
    expect(exit).toHaveBeenCalledWith(1);
  });

  it('exits 1 when app missing from registry', async () => {
    vi.mocked(registry.load).mockReturnValue({
      version: 1, apps: [],
      infrastructure: { databases: { serviceName: '', composePath: '' }, nginx: { configPath: '' } },
    });
    vi.mocked(registry.findApp).mockReturnValue(undefined);
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => { throw new Error('exit'); }) as never);
    await expect(rollbackCommand(['ghost'])).rejects.toThrow('exit');
    expect(exit).toHaveBeenCalledWith(1);
  });

  it('exits 1 when image name cannot be resolved', async () => {
    stubReg();
    vi.mocked(exec.execSafe).mockReturnValue({ ok: false, stdout: '', stderr: 'docker error', exitCode: 1 });
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => { throw new Error('exit'); }) as never);
    await expect(rollbackCommand(['x'])).rejects.toThrow('exit');
    expect(exit).toHaveBeenCalledWith(1);
  });

  it('exits 1 when fleet-previous tag does not exist', async () => {
    stubReg();
    vi.mocked(exec.execSafe)
      .mockReturnValueOnce({ ok: true, stdout: 'x:latest', stderr: '', exitCode: 0 })  // resolveImageName
      .mockReturnValueOnce({ ok: false, stdout: '', stderr: 'no image', exitCode: 1 }); // image inspect fleet-previous
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => { throw new Error('exit'); }) as never);
    await expect(rollbackCommand(['x'])).rejects.toThrow('exit');
    expect(exit).toHaveBeenCalledWith(1);
  });

  it('exits 1 when docker tag fails', async () => {
    stubReg();
    vi.mocked(exec.execSafe)
      .mockReturnValueOnce({ ok: true, stdout: 'x:latest', stderr: '', exitCode: 0 })  // resolveImageName
      .mockReturnValueOnce({ ok: true, stdout: '[{}]', stderr: '', exitCode: 0 })      // image inspect
      .mockReturnValueOnce({ ok: false, stdout: '', stderr: 'tag failed', exitCode: 1 }); // tag
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => { throw new Error('exit'); }) as never);
    await expect(rollbackCommand(['x'])).rejects.toThrow('exit');
    expect(exit).toHaveBeenCalledWith(1);
  });

  it('exits 1 when restartService fails', async () => {
    stubReg();
    vi.mocked(exec.execSafe)
      .mockReturnValueOnce({ ok: true, stdout: 'x:latest', stderr: '', exitCode: 0 })
      .mockReturnValueOnce({ ok: true, stdout: '[{}]', stderr: '', exitCode: 0 })
      .mockReturnValueOnce({ ok: true, stdout: '', stderr: '', exitCode: 0 });
    vi.mocked(systemd.restartService).mockReturnValue(false);
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => { throw new Error('exit'); }) as never);
    await expect(rollbackCommand(['x'])).rejects.toThrow('exit');
    expect(exit).toHaveBeenCalledWith(1);
  });

  it('retags fleet-previous to latest and restarts service on success', async () => {
    stubReg();
    vi.mocked(exec.execSafe)
      .mockReturnValueOnce({ ok: true, stdout: 'x:latest', stderr: '', exitCode: 0 })
      .mockReturnValueOnce({ ok: true, stdout: '[{}]', stderr: '', exitCode: 0 })
      .mockReturnValueOnce({ ok: true, stdout: '', stderr: '', exitCode: 0 });
    vi.mocked(systemd.restartService).mockReturnValue(true);
    await rollbackCommand(['x']);
    expect(exec.execSafe).toHaveBeenCalledWith('docker', ['tag', 'x:fleet-previous', 'x:latest'], expect.anything());
    expect(systemd.restartService).toHaveBeenCalledWith('x-svc');
  });

  it('handles registry:port/repo:tag image names correctly', async () => {
    stubReg();
    vi.mocked(exec.execSafe)
      .mockReturnValueOnce({ ok: true, stdout: 'localhost:5000/my-app:latest', stderr: '', exitCode: 0 })
      .mockReturnValueOnce({ ok: true, stdout: '[{}]', stderr: '', exitCode: 0 })
      .mockReturnValueOnce({ ok: true, stdout: '', stderr: '', exitCode: 0 });
    vi.mocked(systemd.restartService).mockReturnValue(true);
    await rollbackCommand(['x']);
    expect(exec.execSafe).toHaveBeenCalledWith(
      'docker',
      ['tag', 'localhost:5000/my-app:fleet-previous', 'localhost:5000/my-app:latest'],
      expect.anything(),
    );
  });
});
