import React, { createContext, useState, useCallback, useRef } from 'react';

export interface Toast {
  id: string;
  message: string;
  type: 'success' | 'error' | 'info' | 'warning';
  duration: number;
}

export interface ToastContextValue {
  toasts: Toast[];
  addToast: (message: string, type?: Toast['type'], duration?: number) => void;
  removeToast: (id: string) => void;
}

export const ToastContext = createContext<ToastContextValue | null>(null);

interface ToastProviderProps {
  children: React.ReactNode;
  maxToasts?: number;
}

export function ToastProvider({ children, maxToasts = 3 }: ToastProviderProps): React.JSX.Element {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const counterRef = useRef(0);
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const removeToast = useCallback((id: string) => {
    const timer = timersRef.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timersRef.current.delete(id);
    }
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  const addToast = useCallback((message: string, type: Toast['type'] = 'info', duration = 3000) => {
    const id = String(++counterRef.current);
    const toast: Toast = { id, message, type, duration };

    setToasts(prev => {
      const next = [...prev, toast];
      // if over maxToasts, remove the oldest ones
      while (next.length > maxToasts) {
        const oldest = next.shift()!;
        const timer = timersRef.current.get(oldest.id);
        if (timer) {
          clearTimeout(timer);
          timersRef.current.delete(oldest.id);
        }
      }
      return next;
    });

    const timer = setTimeout(() => {
      timersRef.current.delete(id);
      setToasts(prev => prev.filter(t => t.id !== id));
    }, duration);
    timersRef.current.set(id, timer);
  }, [maxToasts]);

  const value: ToastContextValue = { toasts, addToast, removeToast };

  return React.createElement(ToastContext.Provider, { value }, children);
}
