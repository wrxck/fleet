import { createContext, useContext } from 'react';

export const ViewportContext = createContext<number>(20);

export function useAvailableHeight(): number {
  return useContext(ViewportContext);
}
