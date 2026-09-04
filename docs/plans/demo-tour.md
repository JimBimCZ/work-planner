# Demo Tour Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tell a signed-out visitor what they can do on the demo board at `/`, with a five-step
spotlight that lights one real element per step, opens itself once per browser, and is reopenable
from the top bar.

**Architecture:** One client component in the demo layout's top bar owns the whole feature. It
renders the reopen control and, when open, a Radix dialog whose overlay is made transparent so a
single `box-shadow` on a target-sized div supplies the dim. Targets are found with
`document.querySelector` against attributes the board already carries, so the tour is coupled to
the DOM, not to React — **no file under `components/board/` is modified, and neither is
`components/demo/demo-board.tsx`.**

**Tech Stack:** Next.js 16 App Router, TypeScript strict, Tailwind v4, Radix Dialog via
`components/ui/dialog.tsx`, Vitest (`jsdom` per-file pragma), Playwright.

**Spec:** `docs/specs/demo-tour.md` — read it before Task 1. Every "why" lives there; this plan
carries the "how".

## Deviation from the spec, decided while planning

The spec's deliverable 5 says `components/demo/demo-board.tsx` opens the tour on mount. It does
not need to. The dialog renders through a portal and the spotlight measures the DOM with
`querySelector`, so nothing about the tour requires it to sit inside the board's React tree —
and `app/(demo)/layout.tsx` already renders the top bar where the reopen control belongs. Putting
both in one component in the layout means the feature needs no context bridge
(`components/board/board-actions.tsx` is the pattern it would otherwise have to follow) and
touches `demo-board.tsx` not at all. Everything else in the spec is unchanged, including where the
flag is stored and what sets it. Section A's documentation task corrects the spec's deliverable 5.

## Global Constraints

Copied from the spec and `CLAUDE.md`. Every task's requirements implicitly include these.

- **`lib/demo-tour.ts` imports nothing.** The tour is a client component; a value import that
  reached `lib/db` would put the `pg` pool in the browser bundle. `pnpm typecheck`, `pnpm lint` and
  `pnpm test` all pass on that mistake — only `pnpm build` catches it.
- **No file under `components/board/` is modified.** The tour selects against `data-card-id`
  (`components/board/board-card.tsx:169`) and `data-column-id`
  (`components/board/board-column.tsx:117`), which already exist as production markup.
- **No test ids as tour selectors.** `data-testid` is a contract with the test suite; a second
  consumer turns a future selector rename into a silent UI regression.
- **The tour never writes to board state.** No card opens, no card moves, no active column changes,
  nothing dispatches into `BoardCanvas`'s reducer.
- **Nothing reaches the server.** No action, no route handler, no fetch. `e2e/demo.spec.ts:117`
  already asserts this for the demo as a whole and must keep passing.
- **No new colour.** The scrim is `--canvas` at 70%, the value `components/ui/dialog.tsx:41`
  already uses. Nothing warm appears anywhere in the tour.
- **Component tests need the pragma and manual cleanup.** `// @vitest-environment jsdom` at the top
  of the file, and `afterEach(cleanup)` wired by hand — `vitest.config.mts` sets no `globals`, so
  Testing Library never registers its own (`CLAUDE.md`, "Stack").
- **Read exit codes from `$?`, never from a pipeline's tail.** Redirect to a file and echo `$?`.
- **Before any push:** `pnpm typecheck && pnpm lint && pnpm test`.

---

# Section A — the tour, opened by hand

Ships without auto-open, so `e2e/demo.spec.ts`'s ten existing tests are untouched and stay green.
Branch: `feat/demo-tour-section-a`. One PR.

## Task 1: The step list

**Files:**
- Create: `lib/demo-tour.ts`
- Test: `lib/demo-tour.test.ts`

**Interfaces:**
- Consumes: `demoBoard` from `lib/demo-board.ts` (test only).
- Produces: `type TourStep = { id: string; title: string; body: string; selector?: string }`,
  `TOUR_STEPS: TourStep[]`, and
  `visibleSteps(steps: TourStep[], resolve: (selector: string) => DOMRect | null): TourStep[]`.

- [ ] **Step 1: Write the failing test**

Create `lib/demo-tour.test.ts` (node environment — no pragma, this file touches no DOM):

```ts
import { describe, expect, it } from 'vitest';

import { demoBoard } from '@/lib/demo-board';
import { TOUR_STEPS, visibleSteps, type TourStep } from '@/lib/demo-tour';

const fixture = demoBoard(new Date());
const cardIds = new Set(fixture.columns.flatMap((column) => column.cards.map((card) => card.id)));
const columnIds = new Set(fixture.columns.map((column) => column.id));

const box = (width = 100, height = 40) => ({ width, height }) as DOMRect;

describe('TOUR_STEPS', () => {
  it('opens with a step that lights nothing', () => {
    expect(TOUR_STEPS[0].selector).toBeUndefined();
    expect(TOUR_STEPS.slice(1).every((step) => step.selector)).toBe(true);
  });

  it('has unique ids', () => {
    expect(new Set(TOUR_STEPS.map((step) => step.id)).size).toBe(TOUR_STEPS.length);
  });

  // A fixture edit that renames a card must fail here rather than degrade the
  // tour silently in front of a stranger.
  it('names only cards and columns the fixture actually has', () => {
    for (const step of TOUR_STEPS) {
      const card = step.selector?.match(/^\[data-card-id="([^"]+)"\]$/)?.[1];
      const column = step.selector?.match(/^\[data-column-id="([^"]+)"\]$/)?.[1];
      if (card) expect(cardIds).toContain(card);
      if (column) expect(columnIds).toContain(column);
    }
  });

  it('points at cards in two different columns', () => {
    const targeted = TOUR_STEPS.map((step) => step.selector?.match(/^\[data-card-id="([^"]+)"\]$/)?.[1]).filter(
      (id): id is string => Boolean(id),
    );
    const owning = targeted.map(
      (id) => fixture.columns.find((column) => column.cards.some((card) => card.id === id))?.id,
    );
    expect(new Set(owning).size).toBe(owning.length);
  });
});

describe('visibleSteps', () => {
  const steps: TourStep[] = [
    { id: 'a', title: 'A', body: 'a' },
    { id: 'b', title: 'B', body: 'b', selector: '#here' },
    { id: 'c', title: 'C', body: 'c', selector: '#gone' },
    { id: 'd', title: 'D', body: 'd', selector: '#flat' },
  ];
  const resolve = (selector: string) =>
    selector === '#here' ? box() : selector === '#flat' ? box(0, 0) : null;

  it('keeps a step with no selector', () => {
    expect(visibleSteps(steps, resolve).map((step) => step.id)).toContain('a');
  });

  it('drops a step whose element is absent or has no box', () => {
    expect(visibleSteps(steps, resolve).map((step) => step.id)).toEqual(['a', 'b']);
  });
});
```

- [ ] **Step 2: Run the test and watch it fail**

```bash
pnpm exec vitest run lib/demo-tour.test.ts > /tmp/t1.log 2>&1; echo "EXIT=$?"; tail -20 /tmp/t1.log
```

Expected: non-zero exit, `Failed to resolve import "@/lib/demo-tour"`.

- [ ] **Step 3: Write `lib/demo-tour.ts`**

```ts
// The tour's script, and the only place it lives. Imports nothing, in the
// manner of lib/demo-board.ts and the *-limits.ts modules: this is read by a
// client component, and a value import that reached lib/db would put the pg
// pool in the browser bundle, which only `pnpm build` would notice.

export type TourStep = {
  id: string;
  title: string;
  body: string;
  // Absent on the opening step, which is centred and lights nothing:
  // anchoring "this board is real" to one card makes the visitor hunt before
  // they know what they are looking at.
  selector?: string;
};

// Steps 2 and 3 name cards in different columns deliberately — crossing the
// board is what exercises the scroll-into-view at every viewport, so the
// mechanism is proven by the content rather than by a contrived test.
export const TOUR_STEPS: TourStep[] = [
  {
    id: 'welcome',
    title: 'A board you can poke at',
    body: 'Everything here works. Nothing is saved, so move what you like; a reload puts it all back.',
  },
  {
    id: 'open',
    title: 'Open a card',
    body: 'Click any card for its description, labels and comments. This one is three days overdue, which is why its date is warm.',
    selector: '[data-card-id="demo-card-migrate"]',
  },
  {
    id: 'drag',
    title: 'Drag it anywhere',
    body: 'Cards move between columns and reorder within one. Two people can drop in the same place without fighting over it.',
    selector: '[data-card-id="demo-card-drag"]',
  },
  {
    id: 'columns',
    title: 'Columns are yours',
    body: 'Rename, reorder, add or delete them. Colour follows position, so a card moves toward green as it gets closer to done.',
    selector: '[data-column-id="demo-col-done"]',
  },
  {
    id: 'signin',
    title: 'Sign in for a board of your own',
    body: 'Boards, teammates, files, comments, and a log of who did what. Google or GitHub, no password.',
    selector: '[data-tour="signin"]',
  },
];

// Filtered at open time, so the counter reports the steps a visitor will be
// shown rather than the steps that were written. A zero-size box counts as
// absent: an element can be in the DOM and have no geometry.
export function visibleSteps(
  steps: TourStep[],
  resolve: (selector: string) => DOMRect | null,
): TourStep[] {
  return steps.filter((step) => {
    if (!step.selector) return true;
    const rect = resolve(step.selector);
    return rect !== null && rect.width > 0 && rect.height > 0;
  });
}
```

- [ ] **Step 4: Run the test and watch it pass**

```bash
pnpm exec vitest run lib/demo-tour.test.ts > /tmp/t1.log 2>&1; echo "EXIT=$?"; tail -20 /tmp/t1.log
```

Expected: `EXIT=0`, 6 tests passing.

- [ ] **Step 5: Commit**

```bash
git add lib/demo-tour.ts lib/demo-tour.test.ts
git commit -m "feat: script the demo board's guided tour"
```

## Task 2: An overlay the dialog primitive can hand over

The tour's dim is a `box-shadow` on a target-sized div. Radix's own overlay would paint
`bg-canvas/70` over the lit element as well, so it has to be made transparent — and
`DialogContent` renders that overlay itself, with no way to reach it. This adds the one prop that
opens it up, rather than composing a second dialog out of `radix-ui` directly and leaving the
codebase with two ways to build the same thing.

**Files:**
- Modify: `components/ui/dialog.tsx:46-72`
- Test: `components/ui/dialog.test.tsx`

**Interfaces:**
- Produces: `DialogContent` gains `overlayClassName?: string`, merged onto the overlay with `cn`.

- [ ] **Step 1: Write the failing test**

Create `components/ui/dialog.test.tsx`:

```tsx
// @vitest-environment jsdom
// vitest.config.mts registers no setupFiles, so the matchers below
// (toHaveClass, toBeInTheDocument, toHaveTextContent) come from here or not
// at all. components/board/card-comments.test.tsx:2 is the convention.
import '@testing-library/jest-dom/vitest';
import { cleanup, render } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';

import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';

afterEach(cleanup);

it('merges overlayClassName onto the overlay', () => {
  render(
    <Dialog open>
      <DialogContent overlayClassName="bg-transparent">
        <DialogTitle>Hello</DialogTitle>
      </DialogContent>
    </Dialog>,
  );

  const overlay = document.querySelector('[data-slot="dialog-overlay"]');
  expect(overlay).toHaveClass('bg-transparent');
  // tailwind-merge drops the default it replaces rather than stacking both.
  expect(overlay).not.toHaveClass('bg-canvas/70');
});

it('still paints the default scrim when the prop is absent', () => {
  render(
    <Dialog open>
      <DialogContent>
        <DialogTitle>Hello</DialogTitle>
      </DialogContent>
    </Dialog>,
  );

  expect(document.querySelector('[data-slot="dialog-overlay"]')).toHaveClass('bg-canvas/70');
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
pnpm exec vitest run components/ui/dialog.test.tsx > /tmp/t2.log 2>&1; echo "EXIT=$?"; tail -20 /tmp/t2.log
```

Expected: non-zero exit — `overlayClassName` is not a prop, so the overlay keeps `bg-canvas/70`
and the first test fails on `toHaveClass('bg-transparent')`.

- [ ] **Step 3: Add the prop**

In `components/ui/dialog.tsx`, change `DialogContent`'s signature and its overlay:

```tsx
function DialogContent({
  className,
  overlayClassName,
  children,
  showCloseButton = true,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content> & {
  showCloseButton?: boolean
  // The demo tour draws its own scrim as a box-shadow around the lit element,
  // so it needs this overlay transparent — it still blocks pointer events.
  overlayClassName?: string
}) {
  return (
    <DialogPortal>
      <DialogOverlay className={overlayClassName} />
```

Everything else in the function is unchanged.

- [ ] **Step 4: Run it and watch it pass**

```bash
pnpm exec vitest run components/ui/dialog.test.tsx > /tmp/t2.log 2>&1; echo "EXIT=$?"; tail -20 /tmp/t2.log
```

Expected: `EXIT=0`, 2 tests passing.

- [ ] **Step 5: Prove nothing else regressed**

```bash
pnpm exec vitest run > /tmp/t2b.log 2>&1; echo "EXIT=$?"; tail -5 /tmp/t2b.log
```

Expected: `EXIT=0`. Every other dialog in the app passes no `overlayClassName` and keeps
`bg-canvas/70`.

- [ ] **Step 6: Commit**

```bash
git add components/ui/dialog.tsx components/ui/dialog.test.tsx
git commit -m "feat: let a dialog hand its overlay class over"
```

## Task 3: The tour dialog, without positioning

Everything a jsdom test can see: the sequence, the counter, the buttons, the live region, the
flag-free close behaviour. Positioning and scroll arrive in Task 4 — jsdom reports every
`getBoundingClientRect` as 0×0, so it cannot test them and must not pretend to.

**Files:**
- Create: `components/demo/demo-tour.tsx`
- Test: `components/demo/demo-tour.test.tsx`

**Interfaces:**
- Consumes: `TOUR_STEPS`, `visibleSteps`, `TourStep` from `lib/demo-tour.ts`; `Dialog`,
  `DialogContent`, `DialogTitle` from `components/ui/dialog.tsx`.
- Produces: `export function DemoTour(): JSX.Element` — renders the control and the dialog. Takes
  no props; Section B adds no props either.

- [ ] **Step 1: Write the failing test**

Create `components/demo/demo-tour.test.tsx`:

```tsx
// @vitest-environment jsdom
// vitest.config.mts registers no setupFiles, so the matchers below
// (toHaveClass, toBeInTheDocument, toHaveTextContent) come from here or not
// at all. components/board/card-comments.test.tsx:2 is the convention.
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { DemoTour } from '@/components/demo/demo-tour';

afterEach(cleanup);
afterEach(() => vi.restoreAllMocks());

// jsdom gives every element a 0x0 box, which visibleSteps reads as absent —
// so without this only the opening step would survive and the sequence under
// test would be one step long.
beforeEach(() => {
  // cleanup() unmounts React trees; it does not remove nodes this hook
  // appended. Without the reset, the "drops a step" test still finds the
  // previous test's column and the counter never falls to 4.
  document.body.innerHTML = '';
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
    top: 10,
    left: 10,
    width: 100,
    height: 40,
  } as DOMRect);
  Element.prototype.scrollIntoView = vi.fn();
  for (const step of ['demo-card-migrate', 'demo-card-drag']) {
    const el = document.createElement('div');
    el.setAttribute('data-card-id', step);
    document.body.append(el);
  }
  const column = document.createElement('div');
  column.setAttribute('data-column-id', 'demo-col-done');
  document.body.append(column);
  const signin = document.createElement('a');
  signin.setAttribute('data-tour', 'signin');
  document.body.append(signin);
});

const open = async () => {
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: 'What can I try?' }));
  return user;
};

it('opens on the first step and counts the whole sequence', async () => {
  render(<DemoTour />);
  await open();

  expect(screen.getByRole('dialog')).toBeInTheDocument();
  expect(screen.getByText('A board you can poke at')).toBeInTheDocument();
  expect(screen.getByText('1 of 5')).toBeInTheDocument();
});

it('walks forward and back', async () => {
  render(<DemoTour />);
  const user = await open();

  await user.click(screen.getByRole('button', { name: 'Next' }));
  expect(screen.getByText('Open a card')).toBeInTheDocument();
  expect(screen.getByText('2 of 5')).toBeInTheDocument();

  await user.click(screen.getByRole('button', { name: 'Back' }));
  expect(screen.getByText('A board you can poke at')).toBeInTheDocument();
});

it('has no Back on the first step and finishes on the last', async () => {
  render(<DemoTour />);
  const user = await open();

  expect(screen.queryByRole('button', { name: 'Back' })).toBeNull();

  for (let i = 0; i < 4; i += 1) await user.click(screen.getByRole('button', { name: /Next|Done/ }));
  expect(screen.getByText('5 of 5')).toBeInTheDocument();

  await user.click(screen.getByRole('button', { name: 'Done' }));
  expect(screen.queryByRole('dialog')).toBeNull();
});

it('skips out of the middle', async () => {
  render(<DemoTour />);
  const user = await open();

  await user.click(screen.getByRole('button', { name: 'Next' }));
  await user.click(screen.getByRole('button', { name: 'Skip' }));
  expect(screen.queryByRole('dialog')).toBeNull();
});

it('reopens at the first step', async () => {
  render(<DemoTour />);
  const user = await open();

  await user.click(screen.getByRole('button', { name: 'Next' }));
  await user.click(screen.getByRole('button', { name: 'Skip' }));
  await user.click(screen.getByRole('button', { name: 'What can I try?' }));

  expect(screen.getByText('1 of 5')).toBeInTheDocument();
});

it('drops a step whose element is not there, and says so in the counter', async () => {
  document.querySelector('[data-column-id="demo-col-done"]')?.remove();
  render(<DemoTour />);
  await open();

  expect(screen.getByText('1 of 4')).toBeInTheDocument();
});

it('announces the step body politely', async () => {
  render(<DemoTour />);
  await open();

  const live = screen.getByRole('dialog').querySelector('[aria-live="polite"]');
  expect(live).toHaveTextContent('Everything here works.');
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
pnpm exec vitest run components/demo/demo-tour.test.tsx > /tmp/t3.log 2>&1; echo "EXIT=$?"; tail -20 /tmp/t3.log
```

Expected: non-zero exit, `Failed to resolve import "@/components/demo/demo-tour"`.

- [ ] **Step 3: Write the component**

Create `components/demo/demo-tour.tsx`:

```tsx
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
```

- [ ] **Step 4: Run it and watch it pass**

```bash
pnpm exec vitest run components/demo/demo-tour.test.tsx > /tmp/t3.log 2>&1; echo "EXIT=$?"; tail -20 /tmp/t3.log
```

Expected: `EXIT=0`, 7 tests passing.

- [ ] **Step 5: Commit**

```bash
git add components/demo/demo-tour.tsx components/demo/demo-tour.test.tsx
git commit -m "feat: walk a visitor through the demo board"
```

## Task 4: The spotlight

**Files:**
- Modify: `components/demo/demo-tour.tsx`

**Interfaces:**
- Consumes: `TourStep` from `lib/demo-tour.ts`.
- Produces: nothing new for other tasks — the component's public surface is unchanged.

This task has no unit test, and that is a decision rather than an omission: jsdom has no layout, so
the geometry, the scroll and the settle loop can only be proven in a real browser. Task 5's e2e
covers them. The existing component tests must keep passing, which is what Step 3 checks.

- [ ] **Step 1: Add the measurement hook**

At the top of `components/demo/demo-tour.tsx`, after the imports:

```tsx
// The whole import line becomes this — Task 3 left it at useCallback, useRef,
// useState. A second `from 'react'` statement is a lint error.
import { useCallback, useEffect, useRef, useState } from 'react';

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
  const [box, setBox] = useState<Box | null>(null);

  useEffect(() => {
    if (!open || !selector) {
      setBox(null);
      return;
    }

    const element = document.querySelector(selector);
    if (!element) {
      setBox(null);
      return;
    }

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
        setBox(next);
        return;
      }
      frame = requestAnimationFrame(tick);
    };

    frame = requestAnimationFrame(tick);

    const remeasure = () => setBox(boxOf(selector));
    window.addEventListener('resize', remeasure);

    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('resize', remeasure);
    };
  }, [selector, open]);

  return box;
}

// Beside the target, flipped to its left when the right would leave the
// viewport, and clamped so the card is never partly off the bottom.
function placeCard(box: Box): { top: number; left: number } {
  const right = box.left + box.width + GAP;
  const fitsRight = right + CARD_W <= window.innerWidth - GAP;
  return {
    left: fitsRight ? right : Math.max(GAP, box.left - GAP - CARD_W),
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
```

- [ ] **Step 2: Use it in `DemoTour`**

Inside the component, after `const last = …`:

```tsx
  const box = useTargetBox(step?.selector, open);
  const placement = box ? placeCard(box) : null;
```

Render `<Spotlight box={box} />` immediately before the `<Dialog>`:

```tsx
      {open && box ? <Spotlight box={box} /> : null}
```

And give the anchored step card its position, replacing the existing `DialogContent` opening tag:

```tsx
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
```

Only `className` and `style` are new on this tag; every other attribute is Task 3's, unchanged.

The opening step has no `selector`, so `placement` is null and the card keeps
`components/ui/dialog.tsx`'s centred default — which is what "centred, with no spotlight" means.

- [ ] **Step 3: Run the component tests and the whole unit suite**

```bash
pnpm exec vitest run > /tmp/t4.log 2>&1; echo "EXIT=$?"; tail -5 /tmp/t4.log
```

Expected: `EXIT=0`. Task 3's seven tests still pass — they stub `getBoundingClientRect` and
`scrollIntoView`, which is what keeps the settle loop from spinning in jsdom.

- [ ] **Step 4: Commit**

```bash
git add components/demo/demo-tour.tsx
git commit -m "feat: light the element each tour step is about"
```

## Task 5: Put it in the top bar, and prove it in a browser

**Files:**
- Modify: `app/(demo)/layout.tsx:23-42`
- Test: `e2e/demo-tour.spec.ts`

**Interfaces:**
- Consumes: `DemoTour` from `components/demo/demo-tour.tsx`.
- Produces: `data-tour="signin"` on the demo top bar's Sign in link — the selector
  `TOUR_STEPS`'s last step already names.

- [ ] **Step 1: Write the failing e2e**

Create `e2e/demo-tour.spec.ts`:

```ts
import { expect, test } from '@playwright/test';

const openTour = async (page: import('@playwright/test').Page) => {
  await page.getByRole('button', { name: 'What can I try?' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
};

test('opens from the top bar and closes on Escape', async ({ page }) => {
  await page.goto('/');
  await openTour(page);

  await expect(page.getByText('A board you can poke at')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('lights the element the step is about', async ({ page }) => {
  await page.goto('/');
  await openTour(page);
  await page.getByRole('button', { name: 'Next' }).click();

  const spotlight = page.locator('[aria-hidden][style*="box-shadow"]');
  const card = page.locator('[data-card-id="demo-card-migrate"]');

  const lit = await spotlight.boundingBox();
  const target = await card.boundingBox();
  expect(lit).not.toBeNull();
  expect(target).not.toBeNull();
  // The spotlight is inset by PAD on every side.
  expect(Math.abs(lit!.x + 4 - target!.x)).toBeLessThanOrEqual(1);
  expect(Math.abs(lit!.y + 4 - target!.y)).toBeLessThanOrEqual(1);
});

test('walks the whole sequence and finishes', async ({ page }) => {
  await page.goto('/');
  await openTour(page);

  await expect(page.getByText('1 of 5')).toBeVisible();
  for (let i = 0; i < 4; i += 1) await page.getByRole('button', { name: 'Next' }).click();
  await expect(page.getByText('5 of 5')).toBeVisible();

  await page.getByRole('button', { name: 'Done' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

// The assertion that proves the scroll rather than assuming it: at 360px the
// Done column starts far off-screen, and the step about it must bring it in.
test('scrolls a far target into view at 360px', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 720 });
  await page.goto('/');
  await openTour(page);

  for (let i = 0; i < 3; i += 1) await page.getByRole('button', { name: 'Next' }).click();
  await expect(page.getByText('Columns are yours')).toBeVisible();

  const column = await page.locator('[data-column-id="demo-col-done"]').boundingBox();
  expect(column).not.toBeNull();
  expect(column!.x).toBeLessThan(360);
  expect(column!.x + column!.width).toBeGreaterThan(0);
});

test('the board is interactive again after the tour closes', async ({ page }) => {
  await page.goto('/');
  await openTour(page);
  await page.keyboard.press('Escape');

  await page.getByRole('button', { name: 'Move attachments to the EU bucket' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
E2E_PORT=3101 pnpm exec playwright test e2e/demo-tour.spec.ts --reporter=line > /tmp/t5.log 2>&1; echo "EXIT=$?"; tail -20 /tmp/t5.log
```

Expected: non-zero exit — there is no `What can I try?` control yet.

- [ ] **Step 3: Wire it into the layout**

In `app/(demo)/layout.tsx`, add the import:

```tsx
import { DemoTour } from '@/components/demo/demo-tour';
```

Inside the `actions` fragment, put `<DemoTour />` after the two `Demo`/`Nothing here is saved`
spans and before the Privacy link, and give the Sign in link the tour's selector:

```tsx
                <DemoTour />
                <Link
                  href="/privacy"
                  className="rounded-[var(--radius-control)] text-[13px] text-muted hover:text-ink"
                >
                  Privacy
                </Link>
                <Link
                  href="/signin"
                  data-tour="signin"
                  className="rounded-[var(--radius-control)] bg-flow-mid px-3 py-1.5 text-[13px] font-medium text-white"
                >
                  Sign in
                </Link>
```

- [ ] **Step 4: Run the new e2e and watch it pass**

```bash
E2E_PORT=3101 pnpm exec playwright test e2e/demo-tour.spec.ts --reporter=line > /tmp/t5.log 2>&1; echo "EXIT=$?"; tail -20 /tmp/t5.log
```

Expected: `EXIT=0`, 5 passed. Compare the number that ran against the number collected.

- [ ] **Step 5: Prove the existing demo suite is untouched**

```bash
E2E_PORT=3101 pnpm exec playwright test e2e/demo.spec.ts --reporter=line > /tmp/t5b.log 2>&1; echo "EXIT=$?"; tail -5 /tmp/t5b.log
```

Expected: `EXIT=0`, 10 passed. Section A adds no auto-open, so nothing here needed changing.

- [ ] **Step 6: Look at it, in both themes and both widths**

Start the dev server, open `/`, and walk the tour at 1440px and at 360px, in light and dark.
Emulate `prefers-reduced-motion: reduce` and confirm the scroll is instant and nothing else moves.
Keep the four screenshots for the PR body. Shut the server down afterwards.

- [ ] **Step 7: Commit**

```bash
git add "app/(demo)/layout.tsx" e2e/demo-tour.spec.ts
git commit -m "feat: offer the tour from the demo top bar"
```

## Task 6: The documents

**Files:**
- Modify: `docs/specs/demo-board.md:18`, `docs/specs/demo-board.md:36`
- Modify: `docs/specs/demo-tour.md` (deliverable 5's owner)
- Modify: `CLAUDE.md` (Layout, Open decisions)

- [ ] **Step 1: Amend `docs/specs/demo-board.md:18`**

The paragraph currently reads "**Nothing a visitor does is written anywhere.** Not to a database,
not to a session, not to `localStorage`." Section B makes the last clause false. Replace it with a
sentence that separates the two claims:

> **No board content a visitor produces is written anywhere.** Not to a database, not to a
> session, not to `localStorage`. A drag mutates the client's reducer and stops there; a reload
> restores the board exactly as it shipped. The one thing that *is* stored is a flag recording
> that the guided tour has been seen (`docs/specs/demo-tour.md`) — not board content, not sent
> anywhere, and not readable by the server.

- [ ] **Step 2: Amend `docs/specs/demo-board.md:36`**

The "No marketing page" non-goal becomes:

> - **No marketing page.** No hero copy, no feature grid, no pricing, no OG image work, no
>   sitemap. The board is the pitch — which is why the guided tour in
>   `docs/specs/demo-tour.md` points at the board rather than describing the product.

- [ ] **Step 3: Correct `docs/specs/demo-tour.md`'s deliverable 5**

Its first line names `components/demo/demo-board.tsx` as the component that opens the tour. Change
it to `components/demo/demo-tour.tsx`, and add the reason from this plan's "Deviation" section:
the dialog portals and the spotlight measures the DOM, so nothing requires the tour to sit inside
the board's React tree, and living in the layout means no context bridge and no change to
`demo-board.tsx`.

- [ ] **Step 4: Update `CLAUDE.md`**

In "Layout", under `components/demo/`:

```
    demo-tour.tsx             # the guided tour: the top bar's control, the
                              # step card, and the box-shadow spotlight. Finds
                              # its targets with querySelector against
                              # data-card-id / data-column-id, so it changes
                              # nothing under components/board/
```

and beside `lib/demo-board.ts` in the same tree:

```
  demo-tour.ts                # the tour's five steps; imports nothing, see
                              # "Data model"
```

In "Open decisions", extend the settled demo-board paragraph with: the demo board carries a
five-step guided tour that opens once per browser and is reopenable from its top bar;
`docs/specs/demo-tour.md` holds the reasoning, including why it points rather than lets the
visitor perform each step.

- [ ] **Step 5: Commit**

```bash
git add docs/specs/demo-board.md docs/specs/demo-tour.md CLAUDE.md
git commit -m "docs: record the demo tour and what it changes"
```

- [ ] **Step 6: Ship Section A**

```bash
pnpm typecheck && pnpm lint && pnpm test
E2E_PORT=3101 pnpm exec playwright test --reporter=line > /tmp/e2e-a.log 2>&1; echo "EXIT=$?"; tail -5 /tmp/e2e-a.log
```

Then `gh pr create` against `main`, with the four screenshots, the observed exit codes, and a note
that auto-open is Section B. Stop there and hand back — do not start Section B on this context.

---

# Section B — auto-open on first visit

Branch: `feat/demo-tour-section-b`, from `main` once Section A has landed. Confirm the base is real
before starting: `git merge-base --is-ancestor origin/main HEAD`.

## Task 7: Open it once per browser

**Files:**
- Modify: `components/demo/demo-tour.tsx`
- Test: `components/demo/demo-tour.test.tsx`

**Interfaces:**
- Produces: the `localStorage` key `demo-tour`, value `'seen'`.

- [ ] **Step 1: Write the failing tests**

Add to `components/demo/demo-tour.test.tsx`, and add `localStorage.clear()` to the existing
`beforeEach`:

```tsx
it('opens itself on a first visit', async () => {
  render(<DemoTour />);
  expect(await screen.findByRole('dialog')).toBeInTheDocument();
  expect(screen.getByText('A board you can poke at')).toBeInTheDocument();
});

it('does not open when it has been seen', () => {
  localStorage.setItem('demo-tour', 'seen');
  render(<DemoTour />);
  expect(screen.queryByRole('dialog')).toBeNull();
});

it('remembers a skip', async () => {
  render(<DemoTour />);
  const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: 'Skip' }));
  expect(localStorage.getItem('demo-tour')).toBe('seen');
});

it('remembers reaching the end', async () => {
  render(<DemoTour />);
  const user = userEvent.setup();
  await screen.findByRole('dialog');
  for (let i = 0; i < 4; i += 1) await user.click(screen.getByRole('button', { name: 'Next' }));
  await user.click(screen.getByRole('button', { name: 'Done' }));
  expect(localStorage.getItem('demo-tour')).toBe('seen');
});

it('renders when localStorage throws', async () => {
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
    throw new Error('denied');
  });
  render(<DemoTour />);
  expect(screen.getByRole('button', { name: 'What can I try?' })).toBeInTheDocument();
});
```

The `it('reopens at the first step')` test from Task 3 now needs `localStorage.setItem('demo-tour',
'seen')` before `render`, or the auto-open races its explicit click. Change it in the same step.

- [ ] **Step 2: Run them and watch them fail**

```bash
pnpm exec vitest run components/demo/demo-tour.test.tsx > /tmp/t7.log 2>&1; echo "EXIT=$?"; tail -20 /tmp/t7.log
```

Expected: non-zero exit — nothing opens on mount and nothing writes the key.

- [ ] **Step 3: Add the gate**

In `components/demo/demo-tour.tsx`:

```tsx
const SEEN_KEY = 'demo-tour';

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
```

`close` marks it seen:

```tsx
  const close = useCallback(() => {
    markSeen();
    setOpen(false);
  }, []);
```

Escape and the overlay both route through Radix's `onOpenChange`, which already calls `close`, so
they are covered by that one change.

And the auto-open, after the other hooks:

```tsx
  // On mount, not during render: opening in render would put the dialog in
  // the server-rendered HTML the client then disagrees with, the same hazard
  // useMounted exists to avoid for due dates in board-card.tsx.
  useEffect(() => {
    if (!seen()) start();
  }, [start]);
```

- [ ] **Step 4: Run them and watch them pass**

```bash
pnpm exec vitest run components/demo/demo-tour.test.tsx > /tmp/t7.log 2>&1; echo "EXIT=$?"; tail -20 /tmp/t7.log
```

Expected: `EXIT=0`, 12 tests passing.

- [ ] **Step 5: Commit**

```bash
git add components/demo/demo-tour.tsx components/demo/demo-tour.test.tsx
git commit -m "feat: open the demo tour once per browser"
```

## Task 8: Keep the rest of the demo suite honest

Ten tests in `e2e/demo.spec.ts` `goto('/')` and then click the board. With Task 7 merged, a modal
is in the way of every one of them.

**Files:**
- Create: `e2e/demo-fixture.ts`
- Modify: `e2e/demo.spec.ts`, `e2e/demo-tour.spec.ts`

**Interfaces:**
- Produces: `export const test` — a Playwright `test` extended so every use of it seeds the
  `demo-tour` flag before the page loads.

- [ ] **Step 1: Watch the existing suite break**

```bash
E2E_PORT=3101 pnpm exec playwright test e2e/demo.spec.ts --reporter=line > /tmp/t8.log 2>&1; echo "EXIT=$?"; tail -20 /tmp/t8.log
```

Expected: non-zero exit, with failures reporting an intercepted pointer event. Record which tests
failed — this is the evidence the fixture is needed, and the PR body quotes it.

- [ ] **Step 2: Write the fixture**

Create `e2e/demo-fixture.ts`:

```ts
import { test as base } from '@playwright/test';

// The demo tour opens itself on a first visit, which is a modal over every
// element these specs click. Seeding its flag before the page script runs is
// how a demo test says "not today" — put here rather than in each file so the
// next demo spec inherits it instead of rediscovering the failure.
export const test = base.extend({
  page: async ({ page }, use) => {
    await page.addInitScript(() => {
      try {
        localStorage.setItem('demo-tour', 'seen');
      } catch {
        // Matches the component: a browser that refuses to remember still works.
      }
    });
    await use(page);
  },
});

export { expect } from '@playwright/test';
```

- [ ] **Step 3: Point `e2e/demo.spec.ts` at it**

Replace its `import { expect, test } from '@playwright/test';` with:

```ts
import { expect, test } from './demo-fixture';
```

No test body changes.

- [ ] **Step 4: Run it and watch it pass**

```bash
E2E_PORT=3101 pnpm exec playwright test e2e/demo.spec.ts --reporter=line > /tmp/t8.log 2>&1; echo "EXIT=$?"; tail -5 /tmp/t8.log
```

Expected: `EXIT=0`, 10 passed — the same ten, unmodified.

- [ ] **Step 5: Cover the new behaviour**

In `e2e/demo-tour.spec.ts`, switch the import to `./demo-fixture` — its existing five tests open
the tour by hand and must not race an auto-open — then add two that deliberately do not use the
fixture:

```ts
import { test as raw } from '@playwright/test';

raw('opens itself on a first visit, and not on the next one', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByText('A board you can poke at')).toBeVisible();

  await page.keyboard.press('Escape');
  await page.reload();
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

raw('the top bar brings it back after a dismissal', async ({ page }) => {
  await page.goto('/');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);

  await page.getByRole('button', { name: 'What can I try?' }).click();
  await expect(page.getByText('1 of 5')).toBeVisible();
});
```

- [ ] **Step 6: Run the whole e2e suite**

```bash
E2E_PORT=3101 pnpm exec playwright test --reporter=line > /tmp/e2e-b.log 2>&1; echo "EXIT=$?"; tail -5 /tmp/e2e-b.log
```

Expected: `EXIT=0`. Compare the number that ran against the number collected — a passing count is
not a passing suite.

- [ ] **Step 7: Commit and ship Section B**

```bash
git add e2e/demo-fixture.ts e2e/demo.spec.ts e2e/demo-tour.spec.ts
git commit -m "test: seed the tour flag for the demo suite"
pnpm typecheck && pnpm lint && pnpm test
```

Then `gh pr create` against `main`, quoting the Step 1 failure and the Step 6 exit code, with a
screenshot of the first-visit open. Stop and hand back.

---

## Verification for both sections

- `pnpm typecheck && pnpm lint && pnpm test` before every push.
- The e2e exit code read from `$?`, and the ran-versus-collected counts compared.
- The tour looked at on a running dev server at 1440px and 360px, in light and dark, with
  `prefers-reduced-motion` emulated rather than reasoned about.
- Anything started for a check — dev server, browser — is shut down afterwards.
