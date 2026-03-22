export const colors = {
  primary: 'cyan',
  success: 'green',
  warning: 'yellow',
  error: 'red',
  info: 'blue',
  muted: 'gray',
  text: 'white',
} as const;

export const statusColor: Record<string, string> = {
  active: 'green',
  inactive: 'red',
  failed: 'red',
  activating: 'yellow',
  deactivating: 'yellow',
  'n/a': 'gray',
};

export const healthColor: Record<string, string> = {
  healthy: 'green',
  degraded: 'yellow',
  down: 'red',
  unknown: 'gray',
};
