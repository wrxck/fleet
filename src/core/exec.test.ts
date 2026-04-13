import { describe, it, expect } from 'vitest';
import { execSafe } from './exec.js';

// execSafe uses spawnSync with array args — no shell injection possible.
// Tests exercise real process spawning with safe, known-good binaries.

describe('execSafe', () => {
  it('returns stdout, stderr, exitCode and ok for a successful command', () => {
    const result = execSafe('echo', ['hello world']);
    expect(result.ok).toBe(true);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('hello world');
    expect(result.stderr).toBe('');
  });

  it('returns ok=false for a non-zero exit code', () => {
    const result = execSafe('false', []);
    expect(result.ok).toBe(false);
    expect(result.exitCode).not.toBe(0);
  });

  it('returns ok=false and stderr message when command not found', () => {
    const result = execSafe('__fleet_no_such_command__', ['arg1']);
    expect(result.ok).toBe(false);
    expect(result.stderr).toBeTruthy();
    expect(result.stdout).toBe('');
  });

  it('trims trailing whitespace from stdout', () => {
    const result = execSafe('printf', ['hello\n']);
    expect(result.ok).toBe(true);
    expect(result.stdout).toBe('hello');
  });

  it('captures stderr from commands that write to it', () => {
    const result = execSafe('sh', ['-c', 'echo error >&2; exit 1']);
    expect(result.ok).toBe(false);
    expect(result.stderr).toContain('error');
  });

  it('passes cwd option to the child process', () => {
    const result = execSafe('pwd', [], { cwd: '/tmp' });
    expect(result.ok).toBe(true);
    expect(result.stdout).toBe('/tmp');
  });

  it('passes env overrides to the child process', () => {
    const result = execSafe('sh', ['-c', 'echo $MY_TEST_VAR'], {
      env: { MY_TEST_VAR: 'fleet-test-value' },
    });
    expect(result.ok).toBe(true);
    expect(result.stdout).toBe('fleet-test-value');
  });

  it('handles timeout option without crashing for fast commands', () => {
    const result = execSafe('echo', ['timeout-test'], { timeout: 5000 });
    expect(result.ok).toBe(true);
    expect(result.stdout).toBe('timeout-test');
  });

  it('returns ok=false when process times out', () => {
    // sleep for 10s with a 100ms timeout — should be killed
    const result = execSafe('sleep', ['10'], { timeout: 100 });
    expect(result.ok).toBe(false);
  });

  it('passes stdin input via the input option', () => {
    const result = execSafe('cat', [], { input: 'hello from stdin' });
    expect(result.ok).toBe(true);
    expect(result.stdout).toBe('hello from stdin');
  });

  it('captures multi-line stdout correctly', () => {
    const result = execSafe('printf', ['line1\nline2\nline3']);
    expect(result.ok).toBe(true);
    expect(result.stdout).toContain('line1');
    expect(result.stdout).toContain('line2');
    expect(result.stdout).toContain('line3');
  });

  it('array args prevent shell injection — semicolon is treated as literal', () => {
    // If this were a shell command, the semicolon would run a second command.
    // With spawnSync array args, it is passed as a literal argument to echo.
    const result = execSafe('echo', ['safe; rm -rf /']);
    expect(result.ok).toBe(true);
    expect(result.stdout).toBe('safe; rm -rf /');
  });
});
