'use client';

import { createContext, useContext, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';

import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';

// CardBody is rendered as `children` here, so it is a descendant of this
// component, not a caller of it — it cannot hand CardModal a prop the usual
// way. It registers its dirty check in this ref instead, and the check is
// read back from inside Radix's own onEscapeKeyDown callback below. That is
// the only reliable place to intercept: Radix calls it synchronously, before
// its own dismiss decision, in the same function call — no listener
// registered on `document` runs in time to beat Radix's, including a React
// onKeyDownCapture prop, whose actual dispatch to this tree runs later than
// Radix's own document-level capture listener despite React's listener being
// registered first (verified in a real browser; do not reintroduce that
// approach without re-checking).
const CardEscapeGuard = createContext<{ current: (() => boolean) | null } | null>(null);

export function useCardEscapeGuard(hasUnsavedEdits: () => boolean) {
  const guardRef = useContext(CardEscapeGuard);
  // Refs are for event handlers, not render — this keeps the ref current
  // after every render instead, which still lands well before the next
  // keypress.
  useEffect(() => {
    if (guardRef) guardRef.current = hasUnsavedEdits;
  });
}

// Closing the card is a navigation, not a state change — which is what makes
// browser-back close it and forward reopen it.
export function CardModal({
  children,
  title,
}: {
  children: React.ReactNode;
  title: string;
}) {
  const router = useRouter();
  const guardRef = useRef<(() => boolean) | null>(null);

  return (
    <Dialog open onOpenChange={(open) => !open && router.back()}>
      {/* sm:max-w-sm is shadcn's default confirm-dialog width. The canonical
          page renders this same CardBody at max-w-2xl, so the modal matches
          that instead — otherwise the same card presents at two different
          widths depending on which surface opened it. */}
      <DialogContent
        className="max-h-[85vh] overflow-y-auto sm:max-w-2xl"
        onEscapeKeyDown={(event) => {
          // The actual revert happens in card-body.tsx's own onKeyDown, which
          // still runs as the event continues its bubble to the field.
          // preventDefault here only stops Radix from also closing the card
          // out from under whoever meant to cancel one edit.
          if (guardRef.current?.()) event.preventDefault();
        }}
      >
        {/* Radix only wires up aria-labelledby when a DialogTitle is present
            and warns about nothing when it isn't, so this is the dialog's
            only accessible name. sr-only because the visible title is the
            editable input for a writer; a viewer's own heading is hidden in
            the modal (CardBody's `surface="modal"`) so it is not
            announced twice. */}
        <DialogTitle className="sr-only">{title}</DialogTitle>
        <CardEscapeGuard.Provider value={guardRef}>{children}</CardEscapeGuard.Provider>
      </DialogContent>
    </Dialog>
  );
}
