'use client';

import { createContext, useCallback, useContext, useMemo, useState } from 'react';

type Handler = () => void;
export type CardPatch = { title?: string; dueDate?: string | null };
type PatchCard = (cardId: string, patch: CardPatch) => void;

const BoardActionsContext = createContext<{
  addCard: Handler | null;
  register: (handler: Handler | null) => void;
  patchCard: PatchCard | null;
  registerPatchCard: (handler: PatchCard | null) => void;
} | null>(null);

// A page cannot pass data up into its layout, and the top bar lives in the
// layout while the reducer lives in the page's tree. Registering a callback
// here is the one place the two meet, so both entry points share one path.
export function BoardActionsProvider({ children }: { children: React.ReactNode }) {
  const [addCard, setAddCard] = useState<Handler | null>(null);
  const [patchCard, setPatchCard] = useState<PatchCard | null>(null);

  // setState treats a bare function as an updater, so the handler is stored
  // behind one — passing it directly would call it instead of keeping it.
  const register = useCallback((handler: Handler | null) => setAddCard(() => handler), []);

  const registerPatchCard = useCallback(
    (handler: PatchCard | null) => setPatchCard(() => handler),
    [],
  );

  const value = useMemo(
    () => ({ addCard, register, patchCard, registerPatchCard }),
    [addCard, register, patchCard, registerPatchCard],
  );

  return <BoardActionsContext.Provider value={value}>{children}</BoardActionsContext.Provider>;
}

export function useBoardActions() {
  const context = useContext(BoardActionsContext);
  if (!context) throw new Error('useBoardActions used outside BoardActionsProvider');
  return context;
}
