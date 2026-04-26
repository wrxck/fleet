export type View =
  | 'dashboard'
  | 'app-detail'
  | 'health'
  | 'secrets'
  | 'secret-edit'
  | 'logs'
  | 'logs-multi';

export type SecretsSubView = 'app-list' | 'secret-list';

export interface TuiState {
  currentView: View;
  previousView: View | null;
  selectedApp: string | null;
  selectedSecret: string | null;
  redacted: boolean;
  loading: boolean;
  error: string | null;
  confirmAction: ConfirmAction | null;
  dashboardIndex: number;
  healthIndex: number;
  secretsIndex: number;
  secretsSubView: SecretsSubView;
  appDetailIndex: number;
}

export interface ConfirmAction {
  label: string;
  description: string;
  onConfirm: () => void;
}

export type Action =
  | { type: 'NAVIGATE'; view: View }
  | { type: 'GO_BACK' }
  | { type: 'SELECT_APP'; app: string }
  | { type: 'SELECT_SECRET'; key: string | null }
  | { type: 'SET_LOADING'; loading: boolean }
  | { type: 'SET_ERROR'; error: string | null }
  | { type: 'TOGGLE_REDACT' }
  | { type: 'CONFIRM'; action: ConfirmAction }
  | { type: 'CANCEL_CONFIRM' }
  | { type: 'SET_INDEX'; view: 'dashboard' | 'health' | 'secrets' | 'appDetail'; index: number }
  | { type: 'SET_SECRETS_SUBVIEW'; subView: SecretsSubView };
