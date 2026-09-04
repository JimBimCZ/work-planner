'use client';

import { useCallback, useRef, useState } from 'react';

import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { TOUR_STEPS, visibleSteps } from '@/lib/demo-tour';

const rectOf = (selector: string) => document.querySelector(selector)?.getBoundingClientRect() ?? null;

export function DemoTour() {
  const [open, setOpen] = useState(false);
  const [index, setIndex] = useState(0);
  const nextRef = useRef<HTMLButtonElement>(null);

  // Resolved when the tour opens, not on every render: a step's element is
  // measured once per opening, and the counter has to be stable while the
  // visitor walks the sequence.
  const [steps, setSteps] = useState(TOUR_STEPS);

  const start = useCallback(() => {
    setSteps(visibleSteps(TOUR_STEPS, rectOf));
    setIndex(0);
    setOpen(true);
  }, []);

  const step = steps[index];
  const last = index === steps.length - 1;

  const close = useCallback(() => setOpen(false), []);

  return (
    <>
      <button
        type="button"
        onClick={start}
        className="rounded-[var(--radius-control)] text-[13px] text-muted hover:text-ink"
      >
        What can I try?
      </button>

      <Dialog open={open} onOpenChange={(next) => (next ? start() : close())}>
        {step ? (
          <DialogContent
            showCloseButton={false}
            overlayClassName="bg-transparent supports-backdrop-filter:backdrop-blur-none"
            className="max-w-xs gap-3"
            // Radix focuses the first focusable child, which would be Back or
            // Skip. Next is the one that walks the sequence, so Enter should
            // advance rather than leave.
            onOpenAutoFocus={(event) => {
              event.preventDefault();
              nextRef.current?.focus();
            }}
          >
            <DialogTitle>{step.title}</DialogTitle>
            <p aria-live="polite" className="text-[13px] leading-5 text-muted">
              {step.body}
            </p>
            <div className="flex items-center justify-between gap-3">
              <span className="font-mono text-xs text-muted">
                {index + 1} of {steps.length}
              </span>
              <div className="flex items-center gap-2">
                {index > 0 ? (
                  <button
                    type="button"
                    onClick={() => setIndex((current) => current - 1)}
                    className="rounded-[var(--radius-control)] px-2 py-1 text-[13px] text-muted hover:text-ink"
                  >
                    Back
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={close}
                  className="rounded-[var(--radius-control)] px-2 py-1 text-[13px] text-muted hover:text-ink"
                >
                  Skip
                </button>
                <button
                  type="button"
                  ref={nextRef}
                  onClick={() => (last ? close() : setIndex((current) => current + 1))}
                  className="rounded-[var(--radius-control)] bg-flow-mid px-3 py-1.5 text-[13px] font-medium text-white"
                >
                  {last ? 'Done' : 'Next'}
                </button>
              </div>
            </div>
          </DialogContent>
        ) : null}
      </Dialog>
    </>
  );
}
