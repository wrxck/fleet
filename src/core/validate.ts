const APP_NAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/;
const DOMAIN_RE = /^[a-zA-Z0-9][a-zA-Z0-9.-]*$/;
const BRANCH_RE = /^[a-zA-Z0-9][a-zA-Z0-9._/-]*$/;
const HEALTH_PATH_RE = /^\/[a-zA-Z0-9/_.-]*$/;
const SERVICE_NAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9@._-]*$/;
// Secret keys must be valid env var names (alphanumeric + underscore, no leading digit)
const SECRET_KEY_RE = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

function assert(value: string, label: string, pattern: RegExp): void {
  if (!pattern.test(value)) {
    throw new Error(`Invalid ${label}: "${value}" does not match ${pattern}`);
  }
}

function assertNoTraversal(value: string, label: string): void {
  if (value.includes('\0')) throw new Error(`Invalid ${label}: contains null byte`);
  const parts = value.replace(/\\/g, '/').split('/');
  if (parts.includes('..')) throw new Error(`Invalid ${label}: contains path traversal`);
}

export function assertAppName(name: string): void {
  assert(name, 'app name', APP_NAME_RE);
}

export function assertServiceName(name: string): void {
  assert(name, 'service name', SERVICE_NAME_RE);
}

export function assertDomain(domain: string): void {
  assert(domain, 'domain', DOMAIN_RE);
}

export function assertBranch(branch: string): void {
  assert(branch, 'branch name', BRANCH_RE);
  assertNoTraversal(branch, 'branch name');
}

export function assertHealthPath(path: string): void {
  assert(path, 'health path', HEALTH_PATH_RE);
  assertNoTraversal(path, 'health path');
}

export function assertFilePath(path: string): void {
  assertNoTraversal(path, 'file path');
}

export function assertSecretKey(key: string): void {
  assert(key, 'secret key', SECRET_KEY_RE);
}
