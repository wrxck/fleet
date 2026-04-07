import { useContext } from 'react';

import { ToastContext } from './context.js';
import type { Toast } from './context.js';

export function useToast(): { toast: (message: string, type?: Toast['type'], duration?: number) => void } {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error('useToast must be used within a <ToastProvider>');
  }
  return {
    toast: ctx.addToast,
  };
}
