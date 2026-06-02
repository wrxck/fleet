// tool risk tiers — single source of truth the root daemon's guard uses to
// decide whether an mcp tool call is allowed. see src/mcp/guard.ts.
//
//   read        observes state only; allowed by default.
//   mutate      changes vault/registry/config state, recoverable; allowed by default.
//   destructive restarts/redeploys services, pushes outward, or rotates keys;
//               denied by default, operator opts in per-tool in mcp-policy.json.
//
// any tool not listed is treated as destructive (fail-closed) so a newly added
// or unmapped tool can never run through the daemon until classified. the daemon
// logs an unmapped-tool audit event when it sees one.

export type Tier = 'read' | 'mutate' | 'destructive';

export const TOOL_TIERS: Readonly<Record<string, Tier>> = {
  // registry / status (registry-bridge)
  fleet_list: 'read',
  fleet_status: 'read',
  fleet_health: 'read',
  fleet_start: 'destructive',
  fleet_stop: 'destructive',
  fleet_restart: 'destructive',
  fleet_deploy: 'destructive',
  fleet_rollback: 'destructive',
  fleet_freeze: 'destructive',
  fleet_unfreeze: 'destructive',

  // logs / egress (read-only observability)
  fleet_logs: 'read',
  fleet_logs_recent: 'read',
  fleet_logs_summary: 'read',
  fleet_logs_search: 'read',
  fleet_logs_status: 'read',
  fleet_egress_snapshot: 'read',

  // nginx
  fleet_nginx_list: 'read',
  fleet_nginx_add: 'mutate',

  // secrets
  fleet_secrets_status: 'read',
  fleet_secrets_list: 'read',
  fleet_secrets_validate: 'read',
  fleet_secrets_drift: 'read',
  fleet_secrets_get: 'read',
  fleet_secrets_set: 'mutate',
  fleet_secrets_seal: 'mutate',
  fleet_secrets_unseal: 'mutate',
  fleet_secrets_restore: 'mutate',

  // registry mutation
  fleet_register: 'mutate',

  // git (push / pr / release reach outside the host, so destructive)
  fleet_git_status: 'read',
  fleet_git_pr_list: 'read',
  fleet_git_branch: 'mutate',
  fleet_git_commit: 'mutate',
  fleet_git_onboard: 'mutate',
  fleet_git_push: 'destructive',
  fleet_git_pr_create: 'destructive',
  fleet_git_release: 'destructive',

  // deps
  fleet_deps_scan: 'read',
  fleet_deps_status: 'read',
  fleet_deps_app: 'read',
  fleet_deps_config: 'mutate',
  fleet_deps_ignore: 'mutate',
  fleet_deps_fix: 'destructive',

  // audit
  fleet_audit_status: 'read',
  fleet_audit_guidelines: 'read',
  fleet_audit_run: 'mutate',
  fleet_audit_ignore: 'mutate',

  // testflight (read-only)
  fleet_testflight_builds: 'read',
  fleet_testflight_doctor: 'read',

  // remote build runners
  fleet_runner_list: 'read',
  fleet_runner_status: 'read',
  fleet_runner_register: 'mutate',
  fleet_runner_remove: 'mutate',
};

// tier for a tool name, fail-closed to destructive when unmapped.
export function tierOf(tool: string): Tier {
  return TOOL_TIERS[tool] ?? 'destructive';
}

// true when the tool name has no explicit classification (audited as a warning).
export function isUnmapped(tool: string): boolean {
  return !(tool in TOOL_TIERS);
}
