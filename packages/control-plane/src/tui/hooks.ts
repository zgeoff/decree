import { useRef } from 'react';
import type { StoreApi } from 'zustand';
import type { TUIEngine } from './store.ts';
import { createTUIStore } from './store.ts';
import type { TUIActions, TUILocalState } from './types.ts';

export interface UseEngineConfig {
  engine: TUIEngine;
}

export function useEngine(config: UseEngineConfig): StoreApi<TUILocalState & TUIActions> {
  const storeRef = useRef<ReturnType<typeof createTUIStore> | null>(null);

  if (storeRef.current === null) {
    storeRef.current = createTUIStore({ engine: config.engine });
  }

  return storeRef.current;
}
