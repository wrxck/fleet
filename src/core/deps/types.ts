import type { AppEntry } from '../registry.js';

export type CollectorType =
  | 'npm' | 'composer' | 'pip'
  | 'docker-image' | 'docker-running'
  | 'eol' | 'vulnerability' | 'github-pr';

export type Severity = 'critical' | 'high' | 'medium' | 'low' | 'info';

export type FindingCategory =
  | 'outdated-dep' | 'image-update' | 'eol-warning'
  | 'vulnerability' | 'pending-pr';

export interface Finding {
  appName: string;
  source: CollectorType;
  severity: Severity;
  category: FindingCategory;
  title: string;
  detail: string;
  package?: string;
  currentVersion?: string;
  latestVersion?: string;
  eolDate?: string;
  cveId?: string;
  prUrl?: string;
  fixable: boolean;
  updatedAt: string;
}

export interface ScanError {
  collector: CollectorType;
  appName?: string;
  message: string;
  timestamp: string;
}

export interface IgnoreRule {
  appName?: string;
  package?: string;
  source?: CollectorType;
  reason: string;
  until?: string;
}

export interface DepsConfig {
  scanIntervalHours: number;
  concurrency: number;
  notifications: {
    telegram: {
      enabled: boolean;
      chatId: string;
      minSeverity: Severity;
    };
  };
  ignore: IgnoreRule[];
  severityOverrides: {
    eolDaysWarning: number;
    majorVersionBehind: Severity;
    minorVersionBehind: Severity;
    patchVersionBehind: Severity;
  };
  /**
   * Regex strings (matched against bare package name) of packages that must
   * NOT be queried against OSV (https://api.osv.dev). OSV is a third-party
   * service operated by Google; sending private/internal package names there
   * leaks the proprietary dependency manifest. Default skips the user's own
   * npm scope.
   */
  osvSkipPatterns: string[];
}

export interface DepsCache {
  version: 1;
  lastScan: string;
  scanDurationMs: number;
  findings: Finding[];
  errors: ScanError[];
  config: DepsConfig;
}

export interface Collector {
  type: CollectorType;
  detect(appPath: string): boolean;
  collect(app: AppEntry): Promise<Finding[]>;
}
