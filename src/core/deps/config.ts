import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { DepsConfig } from './types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_CONFIG_PATH = join(__dirname, '..', '..', '..', 'data', 'deps-config.json');

export function defaultConfig(): DepsConfig {
  return {
    scanIntervalHours: 6,
    concurrency: 5,
    notifications: {
      telegram: {
        enabled: true,
        chatId: '',
        minSeverity: 'info',
      },
    },
    ignore: [],
    severityOverrides: {
      eolDaysWarning: 90,
      majorVersionBehind: 'high',
      minorVersionBehind: 'medium',
      patchVersionBehind: 'low',
    },
    // Skip OSV lookups for the user's own npm scope by default — OSV is a
    // third-party service (Google) and sending internal package names there
    // leaks the proprietary dependency manifest. Backwards compat: if an
    // existing deps-config.json is missing this field, mergeConfig fills it
    // in from these defaults.
    osvSkipPatterns: ['^@matthesketh/'],
  };
}

export function mergeConfig(base: DepsConfig, overrides: Record<string, unknown>): DepsConfig {
  const result = structuredClone(base);
  for (const [key, value] of Object.entries(overrides)) {
    if (value !== null && typeof value === 'object' && !Array.isArray(value) && key in result) {
      const baseVal = (result as unknown as Record<string, unknown>)[key];
      if (baseVal !== null && typeof baseVal === 'object' && !Array.isArray(baseVal)) {
        (result as unknown as Record<string, unknown>)[key] = mergeConfig(
          baseVal as DepsConfig,
          value as Record<string, unknown>,
        );
        continue;
      }
    }
    (result as unknown as Record<string, unknown>)[key] = value;
  }
  return result;
}

export function loadConfig(path: string = DEFAULT_CONFIG_PATH): DepsConfig {
  if (!existsSync(path)) return defaultConfig();
  const raw = readFileSync(path, 'utf-8');
  const parsed = JSON.parse(raw) as Record<string, unknown>;
  return mergeConfig(defaultConfig(), parsed);
}

export function saveConfig(config: DepsConfig, path: string = DEFAULT_CONFIG_PATH): void {
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(path, JSON.stringify(config, null, 2) + '\n');
}

export function configPath(): string {
  return DEFAULT_CONFIG_PATH;
}
