'use client';

// The whole import line becomes this — Task 3 left it at useCallback, useRef,
// useState. A second `from 'react'` statement is a lint error.
import { useCallback, useEffect, useRef, useState } from 'react';

import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { TOUR_STEPS, visibleSteps } from '@/lib/demo-tour';

const rectOf = (selector: string) => document.querySelector(selector)?.getBoundingClientRect() ?? null;

type Box = { top: number; left: number; width: number; height: number };

const SETTLE_FRAMES = 2;
const SETTLE_CAP_MS = 500;
const PAD = 4;
const GAP = 12;
const CARD_W = 320;
const CARD_H = 200;
// The value components/ui/dialog.tsx:41 paints, so the tour's dim is
// indistinguishable from every other modal's.
const SCRIM = 'color-mix(in srgb, var(--canvas) 70%, transparent)';

const boxOf = (selector: string): Box | null => {
  const element = document.querySelector(selector);
  if (!element) return null;
  const rect = element.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return null;
  return { top: rect.top, left: rect.left, width: rect.width, height: rect.height };
};

// Scrolls the target into view, then waits for its rect to stop moving before
// reporting it. Not a fixed timeout, and deliberately not `scrollend`: rect
// stability needs no compatibility lookup, and this runs on whatever browser a
// stranger arrives with.
//
// The scroll is not a small-screen special case. board-canvas.tsx:586 keeps
// every column mounted below 700px, and five 312px columns are wider than a
// 1440px viewport anyway — so a target can be off-screen at any width, and a
// spotlight drawn without scrolling would light a rectangle nobody can see.
function useTargetBox(selector: string | undefined, open: boolean): Box | null {
  // Keyed by the selector it was measured for, so a step change cannot show
  // the previous step's rect while the new one is still settling — and so the
  // effect never clears it synchronously, which react-hooks forbids.
  const [measured, setMeasured] = useState<{ selector: string; box: Box | null } | null>(null);

  useEffect(() => {
    if (!open || !selector) return;

    const element = document.querySelector(selector);
    if (!element) return;

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    element.scrollIntoView({
      block: 'nearest',
      inline: 'center',
      behavior: reduced ? 'auto' : 'smooth',
    });

    let frame = 0;
    let stable = 0;
    let previous: Box | null = null;
    const started = performance.now();

    const tick = () => {
      const next = boxOf(selector);
      const settled =
        next && previous && next.top === previous.top && next.left === previous.left;
      stable = settled ? stable + 1 : 0;
      previous = next;

      if (stable >= SETTLE_FRAMES || performance.now() - started > SETTLE_CAP_MS) {
        setMeasured({ selector, box: next });
        return;
      }
      frame = requestAnimationFrame(tick);
    };

    frame = requestAnimationFrame(tick);

    const remeasure = () => setMeasured({ selector, box: boxOf(selector) });
    window.addEventListener('resize', remeasure);

    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('resize', remeasure);
    };
  }, [selector, open]);

  if (!open || !selector) return null;
  return measured?.selector === selector ? measured.box : null;
}

// Beside the target where there is room, flipped to its left when the right
// would leave the viewport. When neither side fits — a full-width column on a
// phone is wider than the viewport minus the card — it goes below the target
// instead, or above when there is no room below, so the card never covers the
// thing it is pointing at.
function placeCard(box: Box): { top: number; left: number } {
  const right = box.left + box.width + GAP;
  const fitsRight = right + CARD_W <= window.innerWidth - GAP;
  const fitsLeft = box.left - GAP - CARD_W >= GAP;

  if (!fitsRight && !fitsLeft) {
    const below = box.top + box.height + GAP;
    const above = box.top - GAP - CARD_H;
    const left = Math.max(GAP, Math.min(box.left, window.innerWidth - CARD_W - GAP));

    if (below + CARD_H <= window.innerHeight - GAP) return { top: below, left };
    if (above >= GAP) return { top: above, left };

    // A target taller than the viewport — a full-height column on a phone —
    // cannot be cleared on any side. The card goes to the bottom edge, which
    // leaves the column's header and its first cards visible above it.
    return { top: Math.max(GAP, window.innerHeight - CARD_H - GAP), left };
  }

  return {
    left: fitsRight ? right : box.left - GAP - CARD_W,
    top: Math.min(Math.max(GAP, box.top), Math.max(GAP, window.innerHeight - CARD_H)),
  };
}

// The scrim is one box-shadow around the lit element: no SVG mask, no
// four-div letterbox, and the hole is the element's own box. z-40 puts it
// under the portal's z-50, so the dialog's transparent overlay and the step
// card both paint above it.
//
// It does not animate between steps. Moving it would mean transitioning
// top/left/width/height, and CLAUDE.md's motion rule is transform only. The
// smooth scroll is the movement, and it is what reduced motion turns off.
function Spotlight({ box }: { box: Box }) {
  return (
    <div
      aria-hidden
      className="pointer-events-none fixed z-40 rounded-[var(--radius-card)]"
      style={{
        top: box.top - PAD,
        left: box.left - PAD,
        width: box.width + PAD * 2,
        height: box.height + PAD * 2,
        boxShadow: `0 0 0 9999px ${SCRIM}`,
      }}
    />
  );
}

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

  const box = useTargetBox(step?.selector, open);
  const placement = box ? placeCard(box) : null;

  return (
    <>
      <button
        type="button"
        onClick={start}
        className="rounded-[var(--radius-control)] text-[13px] text-muted hover:text-ink"
      >
        What can I try?
      </button>

      {open && box ? <Spotlight box={box} /> : null}

      <Dialog open={open} onOpenChange={(next) => (next ? start() : close())}>
        {step ? (
          <DialogContent
            showCloseButton={false}
            overlayClassName="bg-transparent supports-backdrop-filter:backdrop-blur-none"
            className={`max-w-xs gap-3 ${placement ? 'translate-x-0 translate-y-0' : ''}`}
            style={placement ?? undefined}
            // Unchanged from Task 3. Keep it: nothing in the test suite covers
            // where focus lands, so dropping it here regresses silently.
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
