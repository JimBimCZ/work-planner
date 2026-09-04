'use client';

// The whole import line becomes this — Task 3 left it at useCallback, useRef,
// useState. A second `from 'react'` statement is a lint error.
import { useCallback, useEffect, useRef, useState } from 'react';

import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { TOUR_STEPS, visibleSteps } from '@/lib/demo-tour';

type Box = DOMRect;

// Where the step's target will sit once it has been scrolled into view, plus
// how far it still has to travel to get there. The spotlight and the step card
// are laid out from `box` and carry `dx`/`dy` as a transform, so they ride the
// scroll rather than waiting for it to finish.
type Anchor = { box: Box; dx: number; dy: number };

const SETTLE_CAP_MS = 500;
const PAD = 4;
const GAP = 12;
const CARD_W = 320;
const CARD_H = 200;
// The value components/ui/dialog.tsx:41 paints, so the tour's dim is
// indistinguishable from every other modal's.
const SCRIM = 'color-mix(in srgb, var(--canvas) 70%, transparent)';

const SEEN_KEY = 'demo-tour';

const SCROLL: ScrollIntoViewOptions = { block: 'nearest', inline: 'center' };

const translate = (dx: number, dy: number) => `translate(${dx}px, ${dy}px)`;

// Unprefixed, matching the only other key this app stores — `theme`, written
// by account-menu.tsx and read by the pre-paint script in app/layout.tsx.
// Both sides are wrapped: a private window that throws gets the tour every
// visit, which is the harmless direction.
const seen = () => {
  try {
    return localStorage.getItem(SEEN_KEY) === 'seen';
  } catch {
    return false;
  }
};

const markSeen = () => {
  try {
    localStorage.setItem(SEEN_KEY, 'seen');
  } catch {
    // A browser that refuses to remember shows the tour again. Nothing else
    // depends on this write.
  }
};

// The one measurement helper: used to resolve a step's live rect and, via
// visibleSteps, to decide at open time whether a step has a target at all. A
// zero-size rect is treated as absent in both uses.
const boxOf = (selector: string): Box | null => {
  const element = document.querySelector(selector);
  if (!element) return null;
  const rect = element.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return null;
  return rect;
};

// The rect the target will have once it is in view, measured by scrolling
// there instantly and putting every ancestor's scroll back. No paint happens
// in between — it is one synchronous task — so nothing of it is visible.
//
// It is measured up front because placeCard has to choose a side once, from
// the final geometry. Recomputing placement per frame during the scroll flips
// the card across the target mid-flight: measured at 1200px, step 3's target
// starts with room only on its left and ends with room on its right.
const destination = (element: Element, selector: string): Box | null => {
  const saved: [Element, number, number][] = [];
  for (let node = element.parentElement; node; node = node.parentElement) {
    saved.push([node, node.scrollLeft, node.scrollTop]);
  }

  element.scrollIntoView(SCROLL);
  const box = boxOf(selector);

  for (const [node, left, top] of saved) {
    node.scrollLeft = left;
    node.scrollTop = top;
  }

  return box;
};

// Resolves the step's destination, then keeps the spotlight and the card
// locked to the target for every frame of the smooth scroll — by writing their
// transforms directly rather than through state, because a setState from a
// requestAnimationFrame callback can land after the frame it was measured in
// and the spotlight would trail the card it is lighting.
//
// The scroll is not a small-screen special case. board-canvas.tsx:586 keeps
// every column mounted below 700px, and five 312px columns are wider than a
// 1440px viewport anyway — so a target can be off-screen at any width, and a
// spotlight drawn without scrolling would light a rectangle nobody can see.
function useAnchor(selector: string | undefined, open: boolean) {
  const [anchor, setAnchor] = useState<Anchor | null>(null);
  const spotlightRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Both writes below are the point of the effect rather than a cascade it
    // could avoid: the anchor is a measurement of the live DOM, which no
    // render-time value can produce.
    const write = (dx: number, dy: number) => {
      for (const ref of [spotlightRef, cardRef]) {
        if (ref.current) ref.current.style.transform = translate(dx, dy);
      }
    };

    const element = open && selector ? document.querySelector(selector) : null;
    const target = element && selector ? destination(element, selector) : null;

    if (!element || !selector || !target) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- see above
      setAnchor(null);
      return;
    }

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const from = element.getBoundingClientRect();
    const dx = reduced ? 0 : from.left - target.left;
    const dy = reduced ? 0 : from.top - target.top;

    setAnchor({ box: target, dx, dy });
    write(dx, dy);

    element.scrollIntoView({ ...SCROLL, behavior: reduced ? 'auto' : 'smooth' });

    let frame = 0;
    const started = performance.now();

    const follow = () => {
      const live = boxOf(selector);
      const offsetX = live ? live.left - target.left : 0;
      const offsetY = live ? live.top - target.top : 0;

      if (offsetX === 0 && offsetY === 0) {
        write(0, 0);
        return;
      }

      if (performance.now() - started > SETTLE_CAP_MS) {
        // The scroll never arrived — clamped, or interrupted. Take the rect
        // where it actually stopped rather than lighting the one it aimed at.
        write(0, 0);
        if (live) setAnchor({ box: live, dx: 0, dy: 0 });
        return;
      }

      write(offsetX, offsetY);
      frame = requestAnimationFrame(follow);
    };

    frame = requestAnimationFrame(follow);

    const remeasure = () => {
      const live = boxOf(selector);
      if (!live) return;
      write(0, 0);
      setAnchor({ box: live, dx: 0, dy: 0 });
    };
    window.addEventListener('resize', remeasure);

    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('resize', remeasure);
    };
  }, [selector, open]);

  return { anchor, spotlightRef, cardRef };
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
// It is laid out at the target's destination and moved only by `transform`,
// which is CLAUDE.md's motion rule — the box-shadow and the rect stay put
// while the scroll plays out underneath.
function Spotlight({
  anchor,
  ref,
}: {
  anchor: Anchor;
  ref: React.RefObject<HTMLDivElement | null>;
}) {
  return (
    <div
      ref={ref}
      aria-hidden
      className="pointer-events-none fixed z-40 rounded-[var(--radius-card)]"
      style={{
        top: anchor.box.top - PAD,
        left: anchor.box.left - PAD,
        width: anchor.box.width + PAD * 2,
        height: anchor.box.height + PAD * 2,
        transform: translate(anchor.dx, anchor.dy),
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
    setSteps(visibleSteps(TOUR_STEPS, boxOf));
    setIndex(0);
    setOpen(true);
  }, []);

  const step = steps[index];
  const last = index === steps.length - 1;

  const close = useCallback(() => {
    markSeen();
    setOpen(false);
  }, []);

  // On mount, not during render: opening in render would put the dialog in
  // the server-rendered HTML the client then disagrees with, the same hazard
  // useMounted exists to avoid for due dates in board-card.tsx. useMounted
  // cannot stand in for it here — start() measures the live DOM through
  // visibleSteps, which no render-time value can do — so the cascading render
  // the rule warns about is the mechanism, and it happens once per mount.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- see above
    if (!seen()) start();
  }, [start]);

  const { anchor, spotlightRef, cardRef } = useAnchor(step?.selector, open);
  const placement = anchor ? placeCard(anchor.box) : null;

  return (
    <>
      <button
        type="button"
        onClick={start}
        className="rounded-[var(--radius-control)] text-[13px] text-muted hover:text-ink"
      >
        What can I try?
      </button>

      {open && anchor ? <Spotlight anchor={anchor} ref={spotlightRef} /> : null}

      <Dialog open={open} onOpenChange={(next) => (next ? start() : close())}>
        {step ? (
          <DialogContent
            ref={cardRef}
            showCloseButton={false}
            // Transparent only while there is a box to cut a hole in — with no
            // box (the opening step, which lights nothing) dialog.tsx's own
            // bg-canvas/70 paints and dims the board evenly, rather than
            // leaving it fully lit.
            overlayClassName={
              anchor
                ? 'bg-transparent supports-backdrop-filter:backdrop-blur-none'
                : 'supports-backdrop-filter:backdrop-blur-none'
            }
            // sm:max-w-xs pins the card at 320px from 640px up too: dialog.tsx
            // carries its own sm:max-w-sm (384px), and twMerge keeps whichever
            // max-w-* key comes later — without this one, placeCard's CARD_W
            // math reserves 64px less than the card actually renders at, and
            // the card overlaps the element it is meant to leave clear.
            // translate-x-0 translate-y-0 cancel dialog.tsx's centring, and
            // they are not interchangeable with the inline transform below:
            // Tailwind v4 compiles -translate-x-1/2 to the standalone
            // `translate` property, which an inline `transform` does not
            // override — dropping them leaves the card half its own size up
            // and to the left of where placeCard put it.
            // transition-none only while anchored: dialog.tsx's duration-100
            // transitions `all` by default, which would animate the inline
            // top/left below — moving the card through layout on every step,
            // and lagging the transform that carries it along the scroll.
            className={`max-w-xs sm:max-w-xs gap-3 ${placement ? 'translate-x-0 translate-y-0 transition-none' : ''}`}
            style={
              placement && anchor
                ? { ...placement, transform: translate(anchor.dx, anchor.dy) }
                : undefined
            }
            // Unchanged from Task 3. Keep it: nothing in the test suite covers
            // where focus lands, so dropping it here regresses silently.
            onOpenAutoFocus={(event) => {
              event.preventDefault();
              nextRef.current?.focus();
            }}
          >
            <DialogTitle>{step.title}</DialogTitle>
            <p aria-live="polite" className="text-[13px] leading-5 text-ink">
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
