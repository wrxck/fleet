// shapes for the App Store compliance audit feature. the report types mirror
// the json emitted by `greenlight preflight --format json` (RevylAI/greenlight,
// internal/cli/preflight.go writePreflightJSON) — kept structurally identical
// so the binary's output deserialises straight into these.

export type GreenlightSeverity = 'CRITICAL' | 'WARN' | 'INFO';
export type GreenlightSource = 'metadata' | 'codescan' | 'privacy' | 'ipa';

export interface GreenlightFinding {
  // which scanner produced this finding
  source: GreenlightSource | string;
  severity: GreenlightSeverity | string;
  // apple review guideline section, e.g. "2.1" — absent for some findings
  guideline?: string;
  title: string;
  detail: string;
  fix?: string;
  file?: string;
  line?: number;
  code?: string;
}

export interface GreenlightSummary {
  total: number;
  critical: number;
  warns: number;
  infos: number;
  // true when there are zero CRITICAL findings
  passed: boolean;
}

export interface GreenlightReport {
  project_path: string;
  ipa_path?: string;
  app_name?: string;
  bundle_id?: string;
  has_privacy_info: boolean;
  // required-reason apis detected in the project
  detected_apis?: string[];
  tracking_sdks?: string[];
  findings: GreenlightFinding[];
  summary: GreenlightSummary;
  // human-readable scan duration, e.g. "412ms"
  elapsed: string;
}

// one stored audit run, keyed in the cache by the target the user named.
export interface AuditRecord {
  // the target as the user referred to it — app name or path
  target: string;
  // the mobile project directory that was actually scanned
  projectPath: string;
  ipaPath?: string;
  ranAt: string;
  report: GreenlightReport;
}

export interface AuditCache {
  version: 1;
  audits: Record<string, AuditRecord>;
}
