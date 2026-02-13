import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

import { loadManifest } from './secrets.js';
import { load } from './registry.js';

export interface ValidationResult {
  app: string;
  ok: boolean;
  missing: string[];
  extra: string[];
}

function extractComposeSecrets(composePath: string, composeFile: string | null): string[] {
  const file = composeFile
    ? join(composePath, composeFile)
    : join(composePath, 'docker-compose.yml');

  if (!existsSync(file)) {
    const alt = join(composePath, 'compose.yml');
    if (!existsSync(alt)) return [];
    return parseSecretsFromFile(alt);
  }
  return parseSecretsFromFile(file);
}

function parseSecretsFromFile(filePath: string): string[] {
  const content = readFileSync(filePath, 'utf-8');
  const secrets: string[] = [];

  // match top-level secrets: block and extract secret names
  const topLevelMatch = content.match(/^secrets:\s*\n((?:[ \t]+\S.*\n?)*)/m);
  if (!topLevelMatch) return [];

  const block = topLevelMatch[1];
  const lines = block.split('\n');

  for (const line of lines) {
    // match "  secret_name:" at 2-space indent (top-level secret definition)
    const nameMatch = line.match(/^[ \t]{2}(\w[\w-]*):\s*$/);
    if (nameMatch) {
      secrets.push(nameMatch[1]);
    }
  }

  return secrets;
}

function getVaultFiles(app: string): string[] {
  const manifest = loadManifest();
  const entry = manifest.apps[app];
  if (!entry) return [];
  return entry.files ?? [];
}

export function validateApp(appName: string): ValidationResult {
  let composePath: string;
  let composeFile: string | null = null;

  if (appName === 'docker-databases') {
    composePath = '/home/matt/docker-databases';
  } else {
    const reg = load();
    const app = reg.apps.find(a => a.name === appName);
    if (!app) {
      return { app: appName, ok: false, missing: [], extra: [`App not found in registry`] };
    }
    composePath = app.composePath;
    composeFile = app.composeFile;
  }

  const composeSecrets = extractComposeSecrets(composePath, composeFile);
  if (composeSecrets.length === 0) {
    return { app: appName, ok: true, missing: [], extra: [] };
  }

  const vaultFiles = getVaultFiles(appName);

  // vault files have .txt extension; compose secret names don't — strip for comparison
  const vaultNames = vaultFiles.map(f => f.replace(/\.txt$/, ''));

  const missing = composeSecrets.filter(s => !vaultNames.includes(s));
  const extra = vaultNames.filter(v => !composeSecrets.includes(v));

  return {
    app: appName,
    ok: missing.length === 0,
    missing,
    extra,
  };
}

export function validateAll(): ValidationResult[] {
  const results: ValidationResult[] = [];

  results.push(validateApp('docker-databases'));

  const reg = load();
  for (const app of reg.apps) {
    results.push(validateApp(app.name));
  }

  return results;
}
