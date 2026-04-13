import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./exec.js', () => ({
  execSafe: vi.fn(),
}));

import { execSafe } from './exec.js';
import { listContainers, inspectContainer, getContainerLogs, getContainersByCompose } from './docker.js';

const mockedExec = vi.mocked(execSafe);

function makeExecResult(stdout: string, ok = true) {
  return { stdout, stderr: '', exitCode: ok ? 0 : 1, ok };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('listContainers', () => {
  it('returns empty array when docker ps fails', () => {
    mockedExec.mockReturnValue(makeExecResult('', false));
    expect(listContainers()).toEqual([]);
  });

  it('returns empty array when stdout is empty', () => {
    mockedExec.mockReturnValue(makeExecResult(''));
    expect(listContainers()).toEqual([]);
  });

  it('parses a single running container', () => {
    mockedExec.mockReturnValue(makeExecResult('myapp\tUp 2 hours\t0.0.0.0:3000->3000/tcp\tmyapp:latest'));
    const result = listContainers();
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('myapp');
    expect(result[0].status).toBe('Up 2 hours');
    expect(result[0].ports).toBe('0.0.0.0:3000->3000/tcp');
    expect(result[0].image).toBe('myapp:latest');
    expect(result[0].health).toBe('none');
  });

  it('parses health status as healthy', () => {
    mockedExec.mockReturnValue(makeExecResult('app\tUp 1 hour (healthy)\t\tapp:latest'));
    const result = listContainers();
    expect(result[0].health).toBe('healthy');
  });

  it('parses health status as unhealthy', () => {
    mockedExec.mockReturnValue(makeExecResult('app\tUp 30 minutes (unhealthy)\t\tapp:latest'));
    const result = listContainers();
    expect(result[0].health).toBe('unhealthy');
  });

  it('parses health status as starting', () => {
    mockedExec.mockReturnValue(makeExecResult('app\tUp 5 seconds (health: starting)\t\tapp:latest'));
    const result = listContainers();
    expect(result[0].health).toBe('starting');
  });

  it('extracts uptime by stripping health from status', () => {
    mockedExec.mockReturnValue(makeExecResult('app\tUp 2 hours (healthy)\t\tapp:latest'));
    const result = listContainers();
    expect(result[0].uptime).toBe('2 hours');
  });

  it('parses multiple containers', () => {
    mockedExec.mockReturnValue(makeExecResult(
      'app-a\tUp 2 hours\t\tapp-a:latest\napp-b\tUp 1 hour (healthy)\t3000/tcp\tapp-b:1.0',
    ));
    const result = listContainers();
    expect(result).toHaveLength(2);
    expect(result[0].name).toBe('app-a');
    expect(result[1].name).toBe('app-b');
    expect(result[1].health).toBe('healthy');
  });

  it('handles missing ports/image columns gracefully', () => {
    mockedExec.mockReturnValue(makeExecResult('myapp\tUp 1 hour\t\t'));
    const result = listContainers();
    expect(result[0].ports).toBe('');
    expect(result[0].image).toBe('');
  });
});

describe('inspectContainer', () => {
  it('returns null when exec fails', () => {
    mockedExec.mockReturnValue(makeExecResult('', false));
    expect(inspectContainer('nonexistent')).toBeNull();
  });

  it('parses valid JSON object', () => {
    mockedExec.mockReturnValue(makeExecResult('{"Id":"abc123","Name":"/myapp"}'));
    const result = inspectContainer('myapp');
    expect(result).toEqual({ Id: 'abc123', Name: '/myapp' });
  });

  it('returns first element when JSON is an array (docker inspect returns array)', () => {
    mockedExec.mockReturnValue(makeExecResult('[{"Id":"abc123","Name":"/myapp"}]'));
    const result = inspectContainer('myapp');
    expect(result).toEqual({ Id: 'abc123', Name: '/myapp' });
  });

  it('returns null for invalid JSON', () => {
    mockedExec.mockReturnValue(makeExecResult('not-valid-json'));
    expect(inspectContainer('myapp')).toBeNull();
  });

  it('returns null for empty stdout', () => {
    mockedExec.mockReturnValue(makeExecResult('[]'));
    // An empty array would return undefined (index 0 of empty array)
    const result = inspectContainer('myapp');
    expect(result).toBeUndefined();
  });
});

describe('getContainerLogs', () => {
  it('returns stdout when command succeeds', () => {
    mockedExec.mockReturnValue(makeExecResult('log line 1\nlog line 2'));
    const result = getContainerLogs('myapp');
    expect(result).toBe('log line 1\nlog line 2');
  });

  it('returns stderr when stdout is empty but ok', () => {
    mockedExec.mockReturnValue({ stdout: '', stderr: 'some stderr output', exitCode: 0, ok: true });
    const result = getContainerLogs('myapp');
    expect(result).toBe('some stderr output');
  });

  it('returns stderr when command fails', () => {
    mockedExec.mockReturnValue({ stdout: '', stderr: 'No such container', exitCode: 1, ok: false });
    const result = getContainerLogs('nonexistent');
    expect(result).toBe('No such container');
  });

  it('returns fallback message when both stdout and stderr are empty on failure', () => {
    mockedExec.mockReturnValue({ stdout: '', stderr: '', exitCode: 1, ok: false });
    const result = getContainerLogs('myapp');
    expect(result).toBe('No logs available');
  });

  it('passes lines parameter to docker logs', () => {
    mockedExec.mockReturnValue(makeExecResult('logs'));
    getContainerLogs('myapp', 50);
    expect(mockedExec).toHaveBeenCalledWith(
      'docker',
      expect.arrayContaining(['--tail', '50']),
      expect.any(Object),
    );
  });
});

describe('getContainersByCompose', () => {
  it('returns empty array when exec fails', () => {
    mockedExec.mockReturnValue(makeExecResult('', false));
    expect(getContainersByCompose('/opt/app', null)).toEqual([]);
  });

  it('returns container names split by newline', () => {
    mockedExec.mockReturnValue(makeExecResult('container-a\ncontainer-b\ncontainer-c'));
    const result = getContainersByCompose('/opt/app', null);
    expect(result).toEqual(['container-a', 'container-b', 'container-c']);
  });

  it('includes -f flag when composeFile is provided', () => {
    mockedExec.mockReturnValue(makeExecResult(''));
    getContainersByCompose('/opt/app', 'docker-compose.prod.yml');
    expect(mockedExec).toHaveBeenCalledWith(
      'docker',
      expect.arrayContaining(['-f', 'docker-compose.prod.yml']),
      expect.any(Object),
    );
  });

  it('does not include -f flag when composeFile is null', () => {
    mockedExec.mockReturnValue(makeExecResult(''));
    getContainersByCompose('/opt/app', null);
    const call = mockedExec.mock.calls[0];
    expect(call[1]).not.toContain('-f');
  });

  it('filters empty lines from output', () => {
    mockedExec.mockReturnValue(makeExecResult('container-a\n\ncontainer-b\n'));
    const result = getContainersByCompose('/opt/app', null);
    expect(result).toEqual(['container-a', 'container-b']);
  });
});
