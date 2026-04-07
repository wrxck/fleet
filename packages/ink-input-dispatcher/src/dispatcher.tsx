import React, { createContext, useContext, useRef, useEffect } from 'react';
import { useInput } from 'ink';
import type { Key } from 'ink';

import type { InputHandler } from './types.js';

const HandlerContext = createContext<React.MutableRefObject<InputHandler | null>>({
  current: null,
});

interface InputDispatcherProps {
  globalHandler?: InputHandler;
  children: React.ReactNode;
}

export function InputDispatcher({ globalHandler, children }: InputDispatcherProps): React.JSX.Element {
  const viewHandlerRef = useRef<InputHandler | null>(null);
  const globalRef = useRef(globalHandler);
  globalRef.current = globalHandler;

  useInput((input: string, key: Key) => {
    // global handler first — if it returns true, input is consumed
    if (globalRef.current) {
      const consumed = globalRef.current(input, key);
      if (consumed) return;
    }

    // fall through to active view handler
    if (viewHandlerRef.current) {
      viewHandlerRef.current(input, key);
    }
  });

  return (
    <HandlerContext.Provider value={viewHandlerRef}>
      {children}
    </HandlerContext.Provider>
  );
}

/**
 * Register the calling component's input handler as the active view handler.
 * Only one handler is active at a time — the last component to call this wins.
 * When the component unmounts, the handler is cleared.
 */
export function useRegisterHandler(handler: InputHandler): void {
  const ref = useContext(HandlerContext);
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  const wrappedRef = useRef<InputHandler | null>(null);
  if (!wrappedRef.current) {
    wrappedRef.current = (input, key) => handlerRef.current(input, key);
  }

  // register synchronously so the handler is available immediately
  ref.current = wrappedRef.current;

  useEffect(() => {
    const wrapped = wrappedRef.current;
    return () => {
      if (ref.current === wrapped) {
        ref.current = null;
      }
    };
  }, [ref]);
}
