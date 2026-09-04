# Spec: Demo tour

Status: approved, not yet implemented
Brainstormed: 2026-09-04

## Goal

Tell a signed-out visitor what they can do on the demo board, on the board itself, before they
work it out by guessing.

`/` serves a real board to anyone with no session (`docs/specs/demo-board.md`), and everything on
it works — cards drag between columns, a card opens into a read-only dialog. None of that
announces itself. A visitor sees a static-looking screenshot of a kanban board and has no reason
to touch it, which wastes the one thing the demo was built to prove: that this is a board you can
poke at.

This spec adds a five-step guided tour over that board. Each step lights one real element and
says, in a sentence, what it does. It opens by itself on a first visit, remembers that it has been
seen, and is reopenable from the top bar afterwards.

**It orients; it does not sell.** The subject of every step is something on the screen in front of
the visitor. The last step names what an account adds, because that is the honest end of the
sequence, not because the tour is a funnel.

## Non-goals

- **No marketing surface.** No hero copy, no feature grid, no pricing, no comparison table, no
  testimonials. `docs/specs/demo-board.md` rules those out and they stay ruled out; this amends
  that line rather than reversing it, because an orientation tour is not a pitch.
- **The tour never writes to board state.** It does not open a card, move a card, change the
  active column or dispatch into `BoardCanvas`'s reducer. It measures the DOM and draws over it.
- **No completion detection.** A step advances when the visitor presses Next, never because they
  performed the action. Point-only was chosen deliberately — see "Settled while brainstorming".
- **The tour does not perform actions itself.** Nothing animates a card across the board.
- **Nothing reaches the server.** No action, no route handler, no request of any kind, which
  `e2e/demo.spec.ts:117` already asserts for the demo as a whole.
- **Not on the real board.** `/boards/[boardId]` gets no tour, no first-run experience and no
  onboarding. This is a surface for people with no account.
- **No change to `components/board/*`.** The tour selects against attributes that are already
  there.
- **No second content surface for small screens.** One step list, filtered.

## Deliverables

### 1. The step list

`lib/demo-tour.ts`, which **imports nothing** — the rule `lib/demo-board.ts` and the `*-limits.ts`
modules follow, and here it is load-bearing for the same reason: the tour is a client component,
and a value import that reached `lib/db` would put the `pg` pool in the browser bundle, which only
`pnpm build` would notice (`CLAUDE.md`, "Auth and permissions").

```ts
export type TourStep = {
  id: string;
  title: string;
  body: string;
  selector?: string;  // absent on the opening step, which is centred
};
```

Five steps, in order:

| # | Target | Copy |
|---|---|---|
| 1 | none, centred | **A board you can poke at** — Everything here works. Nothing is saved, so move what you like; a reload puts it all back. |
| 2 | `[data-card-id="demo-card-migrate"]` | **Open a card** — Click any card for its description, labels and comments. This one is three days overdue, which is why its date is warm. |
| 3 | `[data-card-id="demo-card-drag"]` | **Drag it anywhere** — Cards move between columns and reorder within one. Two people can drop in the same place without fighting over it. |
| 4 | `[data-column-id="demo-col-done"]` | **Columns are yours** — Rename, reorder, add or delete them. Colour follows position, so a card moves toward green as it gets closer to done. |
| 5 | `[data-tour="signin"]` | **Sign in for a board of your own** — Boards, teammates, files, comments, and a log of who did what. Google or GitHub, no password. |

Steps 2 and 3 name cards in different columns deliberately: crossing the board is what exercises
the scroll-into-view in deliverable 3 at every viewport, so the mechanism is proven by the content
rather than by a test that has to contrive it.

The card and column ids are the fixture's own, from `lib/demo-board.ts`. A step whose id no longer
exists in the fixture resolves to nothing and is dropped — see deliverable 3 — so a fixture edit
degrades the tour rather than breaking it. `lib/demo-tour.test.ts` pins the ids against the
fixture so the degradation is caught at the point it is introduced.

### 2. Selectors, and why no board component changes

The targets reuse attributes that already exist as production markup, not test ids:

- `data-card-id` — `components/board/board-card.tsx:169`
- `data-column-id` — `components/board/board-column.tsx:117`

Both are already read by `components/board/board-canvas.tsx:169` for its own measurement, so they
are load-bearing rather than incidental, and selecting against them adds no new coupling.
Test ids were rejected: `data-testid` is a contract with the test suite, and a second consumer
turns every future test-selector change into a silent UI regression.

The one new attribute is `data-tour="signin"` on the Sign in link in `app/(demo)/layout.tsx`,
which is demo-owned. **No file under `components/board/` is modified by this feature.**

### 3. Measuring a step

In order, on every step change:

1. Resolve the selector. No element, or a zero-size rect, and the step is dropped from the
   sequence **at open time**, so the `2 of 4` counter counts the steps that survived rather than
   the steps that were written.
2. Measure the rect the target **will** have once it is in view, by scrolling there instantly and
   putting every ancestor's `scrollLeft`/`scrollTop` back. It is one synchronous task, so no paint
   happens in between and none of it is visible.
3. Position the spotlight and the step card from that destination rect, in the same commit the
   step's text changes. Nothing waits.
4. `scrollIntoView({ block: 'nearest', inline: 'center' })` — smooth, or instant under
   `prefers-reduced-motion` — and, for every frame of it, carry both by the offset the target has
   left to travel, written as a `transform`. Capped at ~500ms, after which the rect where the
   scroll actually stopped is taken instead. The offset is written straight to the two nodes
   rather than through state: a `setState` from a `requestAnimationFrame` callback can land after
   the frame it was measured in, and the spotlight would trail the card it is lighting.

**Measuring the destination up front is what makes the step card stop flying about.** The earlier
build measured *after* the scroll settled, and until it did there was no rect to place anything
from: the spotlight unmounted, the overlay fell back to dimming the whole board, and the card —
losing its inline `top`/`left` — transitioned back to the middle of the viewport and then snapped
out again. Measured on the 2→3 step at 1200px, that lasted 290ms of every Next, which reads as a
page reload rather than as a step. `e2e/demo-tour.spec.ts` samples the transition per frame, since
the end state was never the thing that was wrong.

The destination also has to be known before the card is placed, not after: `placeCard` chooses a
side once, and recomputing it per frame flips the card across the target mid-scroll — measured at
1200px, step 3's target starts with room only on its left and ends with room on its right.

Re-measure on `window.resize`. Nothing else can move the board while the tour is open, because the
modal overlay is swallowing pointer events.

**The scroll is not a small-screen special case.** Below 700px the board is a horizontal snap
scroller and every column is full-width, but `components/board/board-canvas.tsx:586` keeps them
all mounted — so a target off-screen on a phone still resolves, with a real non-zero rect, and a
spotlight drawn from it would light a rectangle nobody can see. Five columns at 312px is also
wider than a 1440px viewport, so the same is true on a desktop. Scrolling the target into view is
what makes the tour correct at every width; the drop rule in step 1 is the guard for a target that
genuinely is not in the DOM, and it will rarely fire.

On a phone the board's own column switcher follows that scroll on its own
(`components/board/board-canvas.tsx:159` already makes the tab track a swipe), so the tour gets a
correct switcher state without writing to board state.

### 4. The tour surface

One Radix dialog from the existing `components/ui/dialog.tsx`. It is chosen over a bespoke overlay
for what it already carries: focus trap, `aria-modal` and Escape. Its modal overlay also blocks the
board underneath, which is exactly what a point-only tour wants.

**Focus is not returned to the trigger on close.** The tour opens from a plain button, not a
`DialogTrigger`, so Radix has nothing to return focus to; after Escape or Skip,
`document.activeElement` is `<body>`. `components/demo/demo-card.tsx` behaves the same way for the
same reason — this is the primitive's behaviour, not something this branch introduces, and it is
recorded here rather than claimed away.

Two pieces inside it:

- **The spotlight** — an absolutely positioned, transparent div matched to the target's rect and
  its border radius, carrying `box-shadow: 0 0 0 9999px <scrim>`. That single shadow *is* the dim.
  No SVG mask and no four-div letterbox: one element, one rule, and the hole is the element's own
  box. It is `aria-hidden` and `pointer-events-none`.
- **The step card** — title, body, a `2 of 5` counter whose total is the number of steps that
  survived deliverable 3's filter rather than the number written down, and Back / Next / Skip.
  Centred, with no spotlight, on the opening step. Otherwise, `placeCard` tries three fallbacks in
  order, because the target's own size and position rule out different sides at different
  viewports: beside the target where there is room, to its left when the right would leave the
  viewport; when neither side fits — a full-width column on a phone is wider than the viewport
  minus the card — below the target instead, or above it when there is no room below; and when the
  target is taller than the viewport can clear on either side, the card sits at the bottom edge,
  because the column's header and its first cards carry its identity and content and both sit at
  the top. Zero overlap with the target is the rule for a normal target and cannot be achieved for
  a target the size of the viewport itself. `e2e/demo-tour.spec.ts` pins both the strict
  no-overlap case and the 200px-visible case that last fallback settles for.

The opening step has no target deliberately: anchoring "this board is real" to a particular card
would make the visitor hunt before they know what they are looking at.

**Neither the spotlight nor the card animates its own geometry.** Both are laid out once per step,
at the destination, and the only thing that moves them is a `transform` carrying the scroll's
remaining offset — `CLAUDE.md`'s motion rule is transform only, never layout properties, and this
keeps it while still letting them ride the scroll instead of waiting it out. The smooth scroll is
the one animated part and the one thing `prefers-reduced-motion` turns off, where the offset is
zero from the first frame. The dialog's own fade is unchanged.

The card's `translate-x-0 translate-y-0` classes are not interchangeable with that inline
`transform`: Tailwind v4 compiles `dialog.tsx`'s `-translate-x-1/2` to the standalone `translate`
property, which an inline `transform` does not override, so dropping them leaves the card half its
own size up and to the left of where `placeCard` put it.

### 5. When it opens, and what remembers

`components/demo/demo-tour.tsx` opens the tour on mount, once, gated on a `localStorage` flag. It
lives in `app/(demo)/layout.tsx`'s top bar, not in `components/demo/demo-board.tsx`: the dialog
renders through a portal and the spotlight finds its target with `querySelector`, so nothing
requires the tour to sit inside the board's React tree, and living in the layout means no context
bridge in the manner of `components/board/board-actions.tsx`, and no change to `demo-board.tsx` at
all. The flag:

```
demo-tour = 'seen'
```

Unprefixed, matching the only other key this app stores — `theme`, written by
`components/app/account-menu.tsx:51` and read by the pre-paint script in `app/layout.tsx:24`. A
namespaced key here would be a second convention for one flag.

Opened **after** mount rather than during render, so it cannot cause a hydration mismatch — the
same reason `useMounted` exists for due dates in `components/board/board-card.tsx`.

Every read and write of the flag is wrapped in `try`/`catch`, the way `app/layout.tsx:24`'s
pre-paint script already wraps its own read. A private window that throws gets the tour on every
visit, which is the harmless direction: a visitor sees it twice rather than a board that fails to
render.

**Escape and Skip both set the flag**, as does reaching the end. Dismissing has to be dismissal,
or the tour returns on the next load and the feature becomes the "opens every visit" variant that
was explicitly rejected.

### 6. The way back in

A `What can I try?` control in the demo top bar (`app/(demo)/layout.tsx`), beside the existing
`Nothing here is saved` note. It reopens the tour at step 1, ignoring the flag.

It is not optional polish: without it the tour is a thing that happens once to each visitor and is
then permanently unreachable, including for anyone who dismissed it by reflex.

At the `min-[700px]` breakpoint the bar already swaps its note for the shorter `Demo`; the control
follows the same pattern rather than adding a third layout.

## What this costs, and why it is accepted

- **It breaks `e2e/demo.spec.ts`.** All ten of its tests `goto('/')`, and a modal that opens on a
  first visit intercepts every click that follows. This is the largest cost in the feature. The
  fix is to seed the flag with `page.addInitScript` in a shared fixture, so the requirement is in
  one place rather than copy-pasted into each test and forgotten by the next one. Section B carries
  it, which is why Section A ships without auto-open.
- **The scrim loses the backdrop blur.** `components/ui/dialog.tsx:41` pairs `bg-canvas/70` with
  `backdrop-blur-xs`; the tour keeps the colour and drops the blur, because a blur cannot have a
  hole cut in it and the spotlighted card has to stay sharp. This is the one place a dialog in
  this app looks different from the others, and it is deliberate.
- **jsdom cannot test the positioning.** Every `getBoundingClientRect` there is 0×0, so the
  spotlight geometry, the scroll-into-view and the drop-a-zero-rect rule are e2e's job and are not
  covered by a unit test. Stated here so it is not discovered as a surprise mid-plan.
- **A first-time visitor is interrupted.** That is the trade the auto-open makes: an orientation
  nobody opens is an orientation nobody reads. It is bounded to once per browser, and Escape
  dismisses it in one keystroke.

## Accessibility

- **The hole is decoration; the words carry the meaning.** A screen-reader user gets nothing from
  a lit rectangle, so every step's copy names its subject in words — "Click any card…", "Rename,
  reorder, add or delete them". No step's body is comprehensible only next to its spotlight.
- Each step supplies a `DialogTitle`, which Radix requires and the demo card already establishes.
- The step body sits in an `aria-live="polite"` region: content changing inside an already-open
  dialog is otherwise announced by nothing.
- Focus order is Back, Skip, Next — DOM order and visual order agree, with the primary control
  rightmost as everywhere else in the app. Next takes focus when the dialog opens, so Enter walks
  the sequence rather than leaving it. No arrow-key bindings: the buttons are enough and Escape
  already means Skip.
- Focus rings are the app's existing 2px accent at 2px offset. Every control is a real `<button>`,
  so `app/globals.css`'s cursor rule applies with nothing added.
- `prefers-reduced-motion` makes the scroll instant. Nothing else in the tour moves.

## Colour rules this stays inside

The tour introduces **no new colour**. The scrim is `--canvas` at 70%, the same value
`components/ui/dialog.tsx:41` uses, so the dim is indistinguishable from every other modal's. The
step card is `--surface` with a `--line` border, at `--radius-modal`. Next is the accent
(`--flow-mid`), matching every other primary button; Back and Skip are quiet text controls.

Nothing warm appears anywhere in the tour. `CLAUDE.md`'s rule is that warm is never decorative and
never at rest on the board, and a tour is neither a due date nor a destructive action. Step 2's
copy *mentions* an overdue card, and the card it lights is warm on its own — the tour adds no
colour of its own to say so.

## Testing

**Unit** — `lib/demo-tour.test.ts`:

- the step list's shape and order;
- every step's card and column id exists in `lib/demo-board.ts`'s fixture;
- the filter that drops steps with no resolvable target, including that the counter reports the
  number that survived.

**Component** — jsdom, with the `// @vitest-environment jsdom` pragma and a hand-wired
`afterEach(cleanup)`, because `vitest.config.mts` sets no `globals` and Testing Library's
automatic cleanup therefore never registers (`CLAUDE.md`, "Stack"):

- Next and Back walk the sequence, and the counter follows;
- Skip closes and sets the flag; Escape does the same;
- reaching the last step and finishing sets the flag;
- the live region holds the current step's body;
- a `localStorage` that throws does not prevent the tour rendering.

**e2e** — `e2e/demo-tour.spec.ts`:

- a first visit opens the tour; a reload does not reopen it;
- the `What can I try?` control reopens it after dismissal;
- the spotlight's box matches the target element's bounding box;
- Next/Back move the spotlight to the expected element;
- at 360px, the step-3 target is scrolled inside the viewport — the assertion that proves the
  scroll mechanism rather than assuming it;
- Escape closes it and the board underneath is interactive again.

Existing `e2e/demo.spec.ts` tests keep passing unchanged in Section A, and pass in Section B via
the seeded flag, not by being rewritten.

## Sections and pull requests

Three, each shippable on its own, each its own branch and PR
(`CLAUDE.md`, "Branches and pull requests"):

- **A — the tour, opened by hand.** `lib/demo-tour.ts`, the tour component, the spotlight, the
  measurement, the `What can I try?` control, `data-tour="signin"`, and the documents in
  "Documentation changed" below. No auto-open, so `e2e/demo.spec.ts` is untouched and stays green.
- **B — auto-open on first visit.** The `localStorage` gate in `components/demo/demo-board.tsx`,
  plus the shared Playwright fixture that seeds the flag for the existing demo specs.
- **C — nothing.** There is no Section C. This is a two-section sub-project, said here explicitly
  because the board legibility sub-project's plan had to say the same thing.

The documents ship inside A rather than as a doc-only PR, because a spec amendment that lands
before the behaviour it describes leaves `docs/specs/demo-board.md` lying for the length of a
review.

## Verification

Beyond `pnpm typecheck && pnpm lint && pnpm test` before any push:

- The e2e suite is run with its exit code read from `$?`, not from a pipeline's tail, and the
  number of tests that ran is compared against the number collected (`CLAUDE.md`, "Never
  assume — prove it").
- The tour is looked at on a running dev server at 1440px and 360px, in both themes, and the
  screenshots go in the PR body.
- `prefers-reduced-motion` is checked by emulating it, not by reading the code.

## Documentation changed in the same pull requests

- `docs/specs/demo-board.md:18` — **the sentence this feature actually contradicts.** It reads
  "Nothing a visitor does is written anywhere. Not to a database, not to a session, not to
  `localStorage`." A dismissal flag is exactly a `localStorage` write, so the paragraph is amended
  to say what stays true and what does not: no board content is written anywhere, and a reload
  still restores the board exactly as it shipped — and one flag records that the tour has been
  seen, which is not board content and is not sent anywhere. Left unamended, the spec would be
  false the day Section B merges, which `CLAUDE.md` treats as a bug in one or the other rather
  than as drift to tolerate.
- `docs/specs/demo-board.md:36` — the "No marketing page" non-goal is amended to name what is now
  true: no hero copy, no feature grid, no pricing, no OG image work, no sitemap, **and** a demo
  orientation tour, which is not marketing. The line is amended rather than deleted, because the
  reasoning it carries — "the board is the pitch" — still holds and is the reason this tour points
  at the board rather than describing the product.
- `CLAUDE.md`, "Layout" — `components/demo/` gains the tour component, and `lib/demo-tour.ts` is
  added beside `lib/demo-board.ts` with its no-imports rule noted.
- `CLAUDE.md`, "Open decisions" — the demo board's settled paragraph gains a sentence for the tour.

## Settled while brainstorming

- **Orientation, not persuasion.** A "why sign up" pitch was the alternative and was rejected: the
  demo board's own spec says the board is the pitch, and a feature grid on top of a working board
  argues with it.
- **Point-only, not do-it-yourself.** Letting the visitor perform each action and advancing on
  completion was considered. It needs a completion signal out of `BoardCanvas` for every step,
  which is coupling this feature does not otherwise have, and a step whose action is impossible at
  a given viewport then has to be specially skippable. Rejected for the machinery, not the idea.
- **The tour does not drive the board.** An earlier answer had it changing the visible column on
  small screens. It does not need to: scrolling the target into view is required at every width
  anyway, and the switcher follows the scroll by itself.
- **"Drop steps whose target is missing" is a guard, not the small-screen mechanism.** It was
  chosen under the belief that the board unmounts off-screen columns below 700px. It does not —
  `components/board/board-canvas.tsx:586` keeps them all mounted — so the rule was kept for the
  case it genuinely covers and the scroll does the real work.
- **Auto-open once, remembered.** Opening on every visit was rejected as nagging; opening only
  from a control was rejected because almost nobody would press it.
- **`localStorage`, not a cookie or a session.** The demo has no session by definition, and a
  cookie would be sent to the server on every request, which the demo's "nothing reaches the
  server" non-goal rules out for a flag nothing server-side reads.
- **The flag contradicts `docs/specs/demo-board.md:18` and that spec is amended, not ignored.**
  That line promises nothing is written "not to a database, not to a session, not to
  `localStorage`", and it was written about board content. Rather than reading it charitably and
  moving on, Section A rewrites it to separate the two claims — see "Documentation changed".

## Open decisions carried forward

None. Both sections are fully specified.
