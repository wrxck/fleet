export type View =
  | 'dashboard'
  | 'app-detail'
  | 'health'
  | 'secrets'
  | 'secret-edit'
  | 'logs';

export interface TuiState {
  currentView: View;
  previousView: View | null;
  selectedApp: string | null;
  selectedSecret: string | null;
  redacted: boolean;
  loading: boolean;
  error: string | null;
  confirmAction: ConfirmAction | null;
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
  | { type: 'CANCEL_CONFIRM' };
