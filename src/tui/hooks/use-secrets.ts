import { useState, useCallback } from 'react';
import { isInitialized, isSealed, loadManifest, listSecrets, decryptApp, sealApp } from '../../core/secrets.js';
import { setSecret, getSecret, unsealAll, sealFromRuntime, importEnvFile } from '../../core/secrets-ops.js';

interface SecretItem {
  key: string;
  maskedValue: string;
}

interface AppSecretInfo {
  app: string;
  type: string;
  keyCount: number;
  lastSealedAt: string;
}

interface SecretsState {
  initialized: boolean;
  sealed: boolean;
  apps: AppSecretInfo[];
  secrets: SecretItem[];
  revealedValues: Record<string, string>;
  loading: boolean;
  error: string | null;
}

interface SecretsActions {
  refresh: () => void;
  loadAppSecrets: (app: string) => void;
  saveSecret: (app: string, key: string, value: string) => Promise<{ ok: boolean; error?: string }>;
  deleteSecret: (app: string, key: string) => Promise<{ ok: boolean; error?: string }>;
  revealSecret: (app: string, key: string) => void;
  hideSecret: (key: string) => void;
  unseal: () => { ok: boolean; error?: string };
  seal: () => Promise<{ ok: boolean; error?: string }>;
  importEnv: (app: string, path: string) => Promise<{ ok: boolean; error?: string }>;
}

export function useSecrets(): SecretsState & SecretsActions {
  const [state, setState] = useState<SecretsState>({
    initialized: false,
    sealed: true,
    apps: [],
    secrets: [],
    revealedValues: {},
    loading: false,
    error: null,
  });

  const refresh = useCallback(() => {
    try {
      const init = isInitialized();
      if (!init) {
        setState(prev => ({ ...prev, initialized: false, sealed: true, apps: [] }));
        return;
      }

      const sealed = isSealed();
      const manifest = loadManifest();
      const apps: AppSecretInfo[] = Object.entries(manifest.apps).map(([app, entry]) => ({
        app,
        type: entry.type,
        keyCount: entry.keyCount,
        lastSealedAt: entry.lastSealedAt,
      }));

      setState(prev => ({ ...prev, initialized: true, sealed, apps, error: null }));
    } catch (err) {
      setState(prev => ({
        ...prev,
        error: err instanceof Error ? err.message : 'Failed to load secrets state',
      }));
    }
  }, []);

  const loadAppSecrets = useCallback((app: string) => {
    try {
      const items = listSecrets(app);
      setState(prev => ({ ...prev, secrets: items, revealedValues: {}, error: null }));
    } catch (err) {
      setState(prev => ({
        ...prev,
        secrets: [],
        error: err instanceof Error ? err.message : 'Failed to load secrets',
      }));
    }
  }, []);

  const saveSecret = useCallback(async (app: string, key: string, value: string): Promise<{ ok: boolean; error?: string }> => {
    try {
      await setSecret(app, key, value);
      // Re-unseal to update runtime
      try { unsealAll(); } catch { /* runtime may not exist yet */ }
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'Failed to save secret' };
    }
  }, []);

  const deleteSecret = useCallback(async (app: string, key: string): Promise<{ ok: boolean; error?: string }> => {
    try {
      const plaintext = decryptApp(app);
      const manifest = loadManifest();
      const entry = manifest.apps[app];

      if (entry.type === 'env') {
        const lines = plaintext.split('\n').filter((line: string) => {
          const eqIdx = line.indexOf('=');
          return !(eqIdx > 0 && line.substring(0, eqIdx) === key);
        });
        sealApp(app, lines.join('\n'), entry.sourceFile);
      }
      try { unsealAll(); } catch { /* runtime may not exist */ }
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'Failed to delete secret' };
    }
  }, []);

  const revealSecret = useCallback((app: string, key: string) => {
    try {
      const value = getSecret(app, key);
      if (value !== null) {
        setState(prev => ({
          ...prev,
          revealedValues: { ...prev.revealedValues, [key]: value },
        }));
      }
    } catch {
      // ignore reveal errors
    }
  }, []);

  const hideSecret = useCallback((key: string) => {
    setState(prev => {
      const { [key]: _, ...rest } = prev.revealedValues;
      return { ...prev, revealedValues: rest };
    });
  }, []);

  const unseal = useCallback((): { ok: boolean; error?: string } => {
    try {
      unsealAll();
      setState(prev => ({ ...prev, sealed: false }));
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'Failed to unseal' };
    }
  }, []);

  const seal = useCallback(async (): Promise<{ ok: boolean; error?: string }> => {
    try {
      await sealFromRuntime();
      setState(prev => ({ ...prev, sealed: true }));
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'Failed to seal' };
    }
  }, []);

  const importEnv = useCallback(async (app: string, path: string): Promise<{ ok: boolean; error?: string }> => {
    try {
      await importEnvFile(app, path);
      try { unsealAll(); } catch { /* ok */ }
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'Failed to import' };
    }
  }, []);

  return {
    ...state,
    refresh,
    loadAppSecrets,
    saveSecret,
    deleteSecret,
    revealSecret,
    hideSecret,
    unseal,
    seal,
    importEnv,
  };
}
