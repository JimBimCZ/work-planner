'use client';

import { useRouter } from 'next/navigation';

import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';

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

  return (
    <Dialog open onOpenChange={(open) => !open && router.back()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        {/* Radix only wires up aria-labelledby when a DialogTitle is present
            and warns about nothing when it isn't, so this is the dialog's
            only accessible name. sr-only because the visible title is the
            editable input (or, for a viewer, CardBody's own heading) inside. */}
        <DialogTitle className="sr-only">{title}</DialogTitle>
        {children}
      </DialogContent>
    </Dialog>
  );
}
