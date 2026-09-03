# Spec: Board legibility

Status: approved, not yet implemented
Brainstormed: 2026-09-03

## Goal

Make the board say what is happening while a card is being dragged, and give a column a body you
can see.

Today a cross-column drag tells the user nothing. `DndContext` in
`components/board/board-canvas.tsx` wires `onDragStart` and `onDragEnd` but not `onDragOver`, so
nothing on screen reacts to where the pointer is until the drop has already happened.
`SortableContext` opens a gap between siblings, but only within one column — drag a card to a
different column and no gap appears, no column reacts, and the only feedback is a card following
the cursor. The user aims at a target that is not drawn.

The column has the matching problem at rest. It is transparent over `--canvas`, distinguished only
by a 3px rule at its top and a hue wash that has faded to nothing by 80px. Below that, one column
and the next are the same undifferentiated field, so there is no visible object to aim at even
before the drag starts.

## Non-goals

- **No change to the drop rules.** Where a card lands is decided by `dropTarget` in
  `lib/board-state.ts` and stays exactly as it is. This spec draws that decision; it does not
  revise it.
- **No column width change.** Columns stay 300px with 12px gutters.
- **No type scale change.** Card title stays 14/20 500, meta stays 12 mono, column header stays
  12 600 uppercase at 0.08em.
- **No WIP limits.** `columns.wipLimit` was dropped deliberately (see `CLAUDE.md`, "Data model").
  The card count added here is a plain count with no limit, no threshold and no warning colour.
- **No density toggle**, no drag handle, no multi-select drag, no auto-scroll at column edges, no
  animation of cards into their new position beyond the drop settle that already exists.
- **No new realtime event.** Nothing here is published or subscribed; the drag state is local to
  the client doing the dragging.
- **No schema change, and therefore no migration.**

## Deliverables

### 1. The drag target, tracked

`components/board/board-canvas.tsx` gains `onDragOver` on its `DndContext`, recording `over.id` in
component state; `onDragEnd` and `onDragCancel` clear it alongside `draggingId`.

Verified against `@dnd-kit/core@6.3.1`: `DndContext` takes `onDragOver={({active, over}) => …}`,
and the keyboard sensor sets `over` the same way the pointer sensor does, so keyboard drags get
every affordance below without extra work.

The recorded id is turned into a target by calling **`dropTarget(state, activeId, overId)` — the
same function `onDragEnd` already calls to decide the real move.** This is the load-bearing
decision in this spec. The indicator is not a second calculation that could drift from the first;
it is the existing one, rendered early. If the line is drawn in the wrong place, the drop is wrong
too, and one fix corrects both. No parallel "where would this go" helper is to be written.

`dropTarget` returns `{ toColumnId, beforeCardId, afterCardId }`, which is enough to place a line:
it goes immediately above the card whose id is `afterCardId`, or below the last card when
`afterCardId` is null.

**Only update state when the computed target changes.** `onDragOver` fires continuously; setting
state on every event re-renders every column on every frame. Compare the derived target against
the one already held and return early when they match.

### 2. The insertion line

Drawn by `components/board/board-column.tsx` from a target prop, in the column's own flow hue via
`flowColor(hue)` from `lib/flow.ts`:

- 3px tall, fully rounded, spanning the card width.
- A round cap at each end, 8px, in the same hue.
- A soft bloom — `0 0 10px` of the hue at 60% alpha.

Placement:

- Between two cards: immediately above the card matching `afterCardId`.
- At the foot: below the last card, when `afterCardId` is null and the column has cards.
- **In an empty column:** where the first card would go, in place of the "Nothing here yet" text
  rather than below it.

The line renders in the target column only. It is drawn for within-column drags as well as
cross-column ones — one code path, one appearance, both directions.

### 3. The hole left behind

`components/board/board-card.tsx` currently drops the source card to `opacity-40` while the
overlay follows the cursor. That reads as a faded copy of a card, which is the one thing it is not.

It becomes a slot cut into the well: the card's content is hidden, the surface goes one step
darker than the well, an inset shadow sinks it, and the border goes away. Unlike the well itself
this direction does **not** invert between themes — cards are lighter than their well in both, so
"away from the card" is downward in both. It keeps the card's exact height so nothing reflows. It should read as absence — the socket the card came out
of — and it is deliberately the darkest element on the board while a drag is in progress.

### 4. The card that follows the cursor

The `DragOverlay` in `board-canvas.tsx` currently renders the title alone in a hardcoded 288px box
with a soft shadow.

- It renders the card's full face — title, due date, labels, attachment count — so what is in
  flight is the card, not a label for it.
- Stronger elevation: `0 20px 34px -10px` at 75%.
- A 1px border in the flow hue of the column the card came **from**, so a card in flight carries
  its origin.
- `scale(1.02)` and the 3° tilt stay as they are, including dropping out under
  `prefers-reduced-motion`.
- **The hardcoded `width: 288` must be derived from the same value the real card uses**, or the
  card in flight is a different size from the hole it left. This is why it is called out: it is a
  literal today and the card width changes in this spec.

### 5. The receiving column arms itself

While a drag is in progress, the column under the pointer — `toColumnId` from the same
`dropTarget` call — lifts:

- its well lifts one step **away from the canvas** — brighter in dark, darker in light. Stated
  as a direction rather than "brighter" because the well is an inverted token: it sits lighter
  than the canvas in dark and darker in light, so a literal "brighten" would pull the light-mode
  well back toward the canvas and *reduce* the distinction it exists to make;
- it gains a 1px inset ring in its own flow hue at 45% alpha;
- its header wash deepens from 6% to 13% and its falloff extends from 80px to 90px;
- its column name and count go from `--muted` to a brighter value.

No other column changes. The board does not dim, and nothing outside the target column moves.

This is what makes the target legible peripherally, without looking straight at a 3px line, and it
is the only part of this spec that works at 360px — where one column fills the screen and the line
alone cannot say whether the pointer has crossed into a different column.

### 6. The column well

`components/board/board-column.tsx` grows a panel inside its existing `<section>`. The section
keeps the fixed width and becomes pure geometry; the panel carries the surface.

- Background `--well`, a new token: `#131820` dark, `#E3E8F0` light.
- Rounded 12px at the foot only. The 3px flow rule caps the top, square.
- The 12px gutter stops being inset padding and becomes a real gap between panels — which makes
  `CLAUDE.md`'s "columns are 300px fixed width with 12px gutters" literally true rather than
  simulated.

The well is a neutral trough in both themes, not hue-tinted. It sits **lighter** than the canvas in
dark and **darker** than the canvas in light, because cards are already pure white there and a
lighter well would collide with them. One token, two values, the same shape as every other colour
in the app. The three steps are `#10141A → #131820 → #19202A` dark and
`#EDF0F5 → #E3E8F0 → #FFFFFF` light, so the card always floats above its own column.

**Below 700px** the panel fills the width: no side gutters, no rounded foot, one column at a time
as today.

### 7. The header, pinned

The column's `<h2>` and its `⋯` menu move **out** of the `overflow-y-auto` element and into the
panel above it.

This fixes a defect, not a preference. The header currently lives inside the scrolling body
(`board-column.tsx:95-113`, inside the scrolling `div` that opens at line 90), so scrolling a long column takes the column's name away while the hue
wash — painted on the scroll container's own box — stays. What is left is colour with no name,
which contradicts `CLAUDE.md`: *"Hue is never the only signal — column names are always visible."*

**The droppable ref stays on the scrolling body.** The existing comment at `board-column.tsx:88`
is right: the empty area below the last card has to remain a drop target, and moving the ref to the
section would change which element answers a drop.

### 8. The card count

A mono count beside the column name, in `--muted`, from the same filtered array the column already
renders. It is the data role the type scale already reserves. When a filter is active it counts
what is shown, matching the cards actually on screen.

### 9. Card breathing room

- Padding 12px → 14px.
- A 58px minimum height, so a bare card and one carrying a due date, labels and an attachment
  count do not differ wildly and rows across columns broadly line up.
- The 8px gap between cards is unchanged.
- Width and the 14/20 title scale are unchanged.

## What this costs, and why it is accepted

**The flow band stops being continuous.** Columns sit flush today precisely so the 3px rules meet
edge to edge and read as one unbroken spectrum, and `CLAUDE.md` calls that the app's signature and
the whole gradient budget. Giving a column its own body means pulling the columns apart, so the
band becomes one cap per column.

This was raised during brainstorming and accepted deliberately. Two things make it cheaper than it
sounds: the hue still derives from position and still re-interpolates with the column count, so the
spectrum reading survives the gaps; and `app/design/page.tsx` has always rendered the spectrum with
`gap-3` — 12px gaps, already separated — so the board now matches its own proof sheet instead of
diverging from it.

`CLAUDE.md` must be corrected in the same pull request that breaks the band. See "Documentation".

## Accessibility

- Every affordance above is driven by `over`, which the keyboard sensor sets, so keyboard drags
  get the line, the armed column, the slot and the overlay without additional code.
- dnd-kit's drag announcements and `aria-roledescription` are untouched.
- The line, the ring and the well are decorative in the accessibility tree — `aria-hidden` — since
  the announcements already say where the card is going. They must not become the only channel.
- `prefers-reduced-motion`: the overlay's tilt and scale already drop out and continue to. The
  bloom on the line drops out too. Brightness and ring changes stay, as they are neither transform
  nor motion.
- Contrast: the well sits between canvas and card in both themes, so body text on a card is
  unaffected. The column name brightening while armed only increases its contrast.

## Colour rules this stays inside

- The line, the caps, the bloom and the arming ring all use the column's **own** flow hue. No new
  hue enters the app.
- The overlay's border uses the source column's flow hue.
- **Nothing warm appears anywhere in this spec.** Warm stays on due dates and destructive actions,
  per `CLAUDE.md`.
- No new gradient. The band and the header wash remain the entire gradient budget; the wash
  deepening while armed is the existing gradient at a different alpha, not a second one.

## Testing

Component tests (`jsdom` pragma, hand-wired `afterEach(cleanup)` per the convention in
`CLAUDE.md`):

- The line renders above the card named by `afterCardId`.
- The line renders below the last card when `afterCardId` is null.
- The line renders in an empty column, in place of "Nothing here yet".
- No line renders in a column that is not the target.
- The armed treatment applies to the target column and to no other.
- The count reflects the filtered card list.
- The header is outside the scrolling element — asserted structurally, since this is the defect
  being fixed and a later refactor could silently undo it.

End-to-end, extending `e2e/board-dnd.spec.ts`:

- **Hold a drag over another column and assert the line's position before dropping.** This is the
  behaviour that does not exist today and the reason the section exists; a test that only asserts
  the card's final position would pass against the current code.
- The line's placement agrees with where the card actually lands, checked in the same test by
  completing the drop — the two come from one function and the test should prove it.
- A viewer, who cannot drag, never sees a line.
- A filtered board, where dragging is disabled, never sees a line.

`pnpm build` must pass: `lib/flow.ts` is already imported by client components, but the new token
plumbing touches `globals.css` and the well is read in a `'use client'` file.

## Sections and pull requests

One section, one branch, one PR, per `CLAUDE.md`.

- **Section A — the drag reads.** `onDragOver`, the target derived from `dropTarget`, the
  insertion line, the slot, the overlay. Branch `feat/board-legibility-drag`.
- **Section B — the column has a body.** The `--well` token, the panel, the pinned header, the
  card count, the armed column, card padding and the height floor. Branch
  `feat/board-legibility-columns`, from `main` once A has landed.

A before B deliberately: the drag work is the complaint that started this, it is independently
shippable, and B's armed-column treatment needs A's target already being tracked.

## Verification

- [ ] `pnpm typecheck && pnpm lint && pnpm test && pnpm build`, each exit code read directly rather
      than through a pipe.
- [ ] `pnpm test:e2e`, with the number that ran compared against the number collected.
- [ ] A cross-column drag shows the line in the target column, observed by hand in a browser, in
      both themes.
- [ ] A keyboard drag shows the same line, observed by hand.
- [ ] At 360px, dragging into the visible column arms it, observed by hand.
- [ ] `prefers-reduced-motion` drops the tilt, the scale and the bloom, observed by hand.
- [ ] Screenshots of a drag in progress, both themes and at 360px, for the PR.

## Documentation changed in the same pull requests

`CLAUDE.md`:

- **"Signature: the flow spectrum"** — the promise that the rules "form one unbroken band across
  the board" is no longer true and must be rewritten to say the band is one cap per column, with
  the reason.
- **"Tokens"** — add `--well`, both values.
- **"UI conventions"** — the 300px/12px gutter line becomes literally true; say so rather than
  leaving the old "inset padding" explanation in the code comment.
- **"Drag and drop"** — record that a drop target is drawn, that it comes from `dropTarget` rather
  than a parallel calculation, and that `onDragOver` exists only to feed it.

## Settled while brainstorming

- **The indicator is `dropTarget` rendered, not a new calculation.** Any future "where would this
  land" helper is a bug waiting to disagree with the drop.
- **The well is neutral, not hue-tinted.** A hue-tinted well was mocked and rejected: it puts
  colour at rest across the whole board, and `CLAUDE.md` reserves colour for function.
- **The board does not dim during a drag.** Considered and rejected — it re-lights the whole board
  on every crossing between columns, which is a lot of peripheral motion on a five-column board,
  and it hides the context the card may be being dragged relative to.
- **Sibling shifting stays.** `verticalListSortingStrategy` continues to open a gap within a
  column. It is dnd-kit doing its job; removing it is more code, not less, and the line is drawn
  into the gap rather than fighting it.
- **The band is broken on purpose.** Not a regression to be fixed later.

## Open decisions carried forward

None from this spec. Board archive versus hard delete remains the only open decision in
`CLAUDE.md`, untouched here.
