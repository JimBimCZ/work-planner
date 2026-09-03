# Board Legibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Draw where a dragged card will land, and give a column a body you can see.

**Architecture:** The indicator is not a new calculation. `dropTarget` in `lib/board-state.ts` already decides where a card lands; today it is called once, on drop. This plan calls it continuously from a new `onDragOver` and renders its answer, so the line and the drop come from one function and cannot disagree. The column gains a panel inside its existing `<section>` — the section keeps the geometry, the panel carries the surface — and the header moves out of the scrolling element it is currently trapped in.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript strict, Tailwind CSS v4, `@dnd-kit/core@6.3.1` + `@dnd-kit/sortable@10.0.0`, Vitest, Playwright.

**Spec:** `docs/specs/board-legibility.md`

## Global Constraints

- **Never assume — prove it.** Read exit codes directly, never through a pipe. `pnpm test 2>&1 | tail` reports `tail`'s status. Use `pnpm test > /tmp/x.log 2>&1; echo "EXIT=$?"`.
- Before any push: `pnpm typecheck && pnpm lint && pnpm test`, each exit code observed.
- **No `any`, no non-null assertions, no `@ts-expect-error`** without an explanation on the line above.
- **No unnecessary comments.** Comment only non-obvious decisions.
- `lib/permissions.ts` and anything importing it is server-only. Client components take derived booleans. This plan touches only client components and pure modules — do not import from `lib/db` or `lib/permissions` in any of them.
- Colour rules: three roles only. The line, its caps, its bloom and the arming ring all use the target column's **own** flow hue via `flowColor()`. The overlay's border uses the **source** column's hue. **Nothing warm appears anywhere in this plan.**
- No new gradient. The 3px band and the header wash remain the entire gradient budget.
- Column width stays 300px, gutters 12px. Card title stays 14/20 500. Card meta stays 12 mono.
- No schema change, no migration, no new Pusher event, no change to `EVENT_NAMES`.
- Two sections, two branches, two PRs. Section A merges before Section B starts.

## File Structure

| File | Responsibility | Section |
|---|---|---|
| `lib/board-state.ts` | Add the exported `DropTarget` type and `sameDropTarget`. `dropTarget` itself is unchanged. | A |
| `lib/board-state.test.ts` | Tests for `sameDropTarget`. | A |
| `components/board/board-column.tsx` | Renders the insertion line; later gains the panel, the pinned header, the count and the armed treatment. | A, B |
| `components/board/board-column.test.tsx` | **New.** Component tests for the line, the header's position, the count. | A, B |
| `components/board/board-card.tsx` | The slot when dragging; exports `CardFace`. | A |
| `components/board/board-card.test.tsx` | Add slot and `CardFace` tests to the existing file. | A |
| `components/board/board-canvas.tsx` | `onDragOver`, the derived target, passing it down, the overlay's face. | A, B |
| `app/globals.css` | `--slot` (A), `--well` (B), `.drop-bloom`. | A, B |
| `e2e/board-dnd.spec.ts` | Extend: hold a drag and assert the line before dropping. | A |
| `CLAUDE.md` | "Drag and drop" (A); "Signature", "Tokens", "UI conventions" (B). | A, B |

`components/board/board-column.test.tsx` is new because the column has no tests today. It follows `board-card.test.tsx`: `renderToStaticMarkup` in the default node environment with the dnd-kit hooks mocked — **not** jsdom. Only tests needing real events use the jsdom pragma, and none here do.

---

# Section A — the drag reads

Branch: `feat/board-legibility-drag`, from `main`.

### Task 1: `DropTarget` and `sameDropTarget`

`onDragOver` fires continuously. Setting state on every event re-renders every column on every frame, so the canvas needs a cheap way to ask "is this the same target I already have?".

**Files:**
- Modify: `lib/board-state.ts:359-380`
- Test: `lib/board-state.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `export type DropTarget = { toColumnId: string; beforeCardId: string | null; afterCardId: string | null }` and `export function sameDropTarget(a: DropTarget | null, b: DropTarget | null): boolean`. `dropTarget` keeps its behaviour and now declares `DropTarget | null` as its return type.

- [x] **Step 1: Write the failing test**

Append to `lib/board-state.test.ts`:

```ts
describe('sameDropTarget', () => {
  const target = { toColumnId: 'c1', beforeCardId: 'a', afterCardId: 'b' };

  test('two nulls are the same target', () => {
    expect(sameDropTarget(null, null)).toBe(true);
  });

  test('a target and null are different', () => {
    expect(sameDropTarget(target, null)).toBe(false);
    expect(sameDropTarget(null, target)).toBe(false);
  });

  test('equal fields are the same target, even as separate objects', () => {
    expect(sameDropTarget(target, { ...target })).toBe(true);
  });

  test('a different column is a different target', () => {
    expect(sameDropTarget(target, { ...target, toColumnId: 'c2' })).toBe(false);
  });

  // The two neighbour fields are what place the line, so a change in either
  // has to re-render even when the column has not changed.
  test('a different neighbour is a different target', () => {
    expect(sameDropTarget(target, { ...target, beforeCardId: 'z' })).toBe(false);
    expect(sameDropTarget(target, { ...target, afterCardId: null })).toBe(false);
  });
});
```

Add `sameDropTarget` to the existing import from `./board-state` at the top of the file.

- [x] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run lib/board-state.test.ts > /tmp/t1.log 2>&1; echo "EXIT=$?"; tail -20 /tmp/t1.log`
Expected: FAIL — `sameDropTarget is not a function`.

- [x] **Step 3: Write minimal implementation**

In `lib/board-state.ts`, above the existing `dropTarget`:

```ts
export type DropTarget = {
  toColumnId: string;
  beforeCardId: string | null;
  afterCardId: string | null;
};

export function sameDropTarget(a: DropTarget | null, b: DropTarget | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    a.toColumnId === b.toColumnId &&
    a.beforeCardId === b.beforeCardId &&
    a.afterCardId === b.afterCardId
  );
}
```

Change `dropTarget`'s signature to use the type. Its body does not change:

```ts
export function dropTarget(state: BoardState, activeId: string, overId: string): DropTarget | null {
```

- [x] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run lib/board-state.test.ts > /tmp/t1.log 2>&1; echo "EXIT=$?"; tail -6 /tmp/t1.log`
Expected: EXIT=0.

- [x] **Step 5: Commit**

```bash
git add lib/board-state.ts lib/board-state.test.ts
git commit -m "feat: name the drop target, and say when two are the same"
```

---

### Task 2: The insertion line

**Files:**
- Modify: `components/board/board-column.tsx`
- Modify: `app/globals.css`
- Test: `components/board/board-column.test.tsx` (create)

**Interfaces:**
- Consumes: `DropTarget` from Task 1; `flowColor` from `lib/flow.ts`.
- Produces: `BoardColumn` gains a required prop `dropIndicator: DropTarget | null`. **The canvas passes it only to the target column and `null` to every other**, so the column itself never compares ids. Every existing call site must pass it.

- [x] **Step 1: Write the failing test**

Create `components/board/board-column.test.tsx`:

```tsx
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, test, vi } from 'vitest';

vi.mock('@dnd-kit/core', () => ({ useDroppable: () => ({ setNodeRef: () => {} }) }));
vi.mock('@dnd-kit/sortable', () => ({
  SortableContext: ({ children }: { children: React.ReactNode }) => children,
  verticalListSortingStrategy: undefined,
  useSortable: () => ({
    attributes: {},
    listeners: {},
    setNodeRef: () => {},
    transform: null,
    transition: undefined,
    isDragging: false,
  }),
}));
vi.mock('@/lib/use-mounted', () => ({ useMounted: () => true }));

const { BoardColumn } = await import('./board-column');

const column = { id: 'col-1', name: 'In progress', rank: 'a0' };

const card = (id: string, title: string, rank: string) => ({
  id,
  columnId: 'col-1',
  title,
  rank,
  createdAt: '2026-09-01T00:00:00.000Z',
  dueDate: null,
  labelIds: [],
  attachmentCount: 0,
});

const cards = [card('c1', 'First', 'a0'), card('c2', 'Second', 'a1')];

const render = (props: Partial<Parameters<typeof BoardColumn>[0]> = {}) =>
  renderToStaticMarkup(
    <BoardColumn
      column={column}
      cards={cards}
      filtering={false}
      rings={new Map()}
      boardId="board-1"
      hue={185}
      nextHue={165}
      canWrite
      composerOpen={false}
      onOpenComposer={() => {}}
      onCloseComposer={() => {}}
      onAddCard={() => {}}
      columns={[column]}
      labels={[]}
      dropIndicator={null}
      onRenameCard={() => {}}
      onDeleteCard={() => {}}
      onMoveCardTo={() => {}}
      isFirst
      isLast
      onRenameColumn={() => {}}
      onAddColumnAfter={() => {}}
      onMoveColumn={() => {}}
      onDeleteColumn={null}
      {...props}
    />,
  );

const indicator = (afterCardId: string | null) => ({
  toColumnId: 'col-1',
  beforeCardId: null,
  afterCardId,
});

describe('the drop indicator', () => {
  test('a column that is not the target draws no line', () => {
    expect(render()).not.toContain('data-testid="drop-indicator"');
  });

  test('the line sits above the card it will land before', () => {
    const html = render({ dropIndicator: indicator('c2') });
    expect(html).toContain('data-testid="drop-indicator"');
    expect(html.indexOf('drop-indicator')).toBeLessThan(html.indexOf('Second'));
    expect(html.indexOf('First')).toBeLessThan(html.indexOf('drop-indicator'));
  });

  test('a null afterCardId puts the line below the last card', () => {
    const html = render({ dropIndicator: indicator(null) });
    expect(html.indexOf('Second')).toBeLessThan(html.indexOf('drop-indicator'));
  });

  test('an empty target column draws the line instead of its empty state', () => {
    const html = render({ cards: [], dropIndicator: indicator(null) });
    expect(html).toContain('data-testid="drop-indicator"');
    expect(html).not.toContain('Nothing here yet');
  });

  test('an empty column that is not the target still says it is empty', () => {
    const html = render({ cards: [] });
    expect(html).toContain('Nothing here yet');
    expect(html).not.toContain('data-testid="drop-indicator"');
  });

  // dnd-kit already announces the move; the line must not be the only channel.
  test('the line is hidden from assistive technology', () => {
    const html = render({ dropIndicator: indicator('c2') });
    const start = html.indexOf('data-testid="drop-indicator"');
    expect(html.slice(start - 120, start)).toContain('aria-hidden');
  });

  // The hue is the column's own, so the line says which column as well as where.
  test('the line takes the column hue, not the accent', () => {
    const html = render({ dropIndicator: indicator('c2'), hue: 185 });
    expect(html).toContain('hsl(185 60% 45%)');
    expect(html).not.toContain('12A594');
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run components/board/board-column.test.tsx > /tmp/t2.log 2>&1; echo "EXIT=$?"; tail -20 /tmp/t2.log`
Expected: FAIL — `dropIndicator` is not a recognised prop and no `drop-indicator` element exists.

- [x] **Step 3: Write minimal implementation**

In `app/globals.css`, after the `.card-enter` block:

```css
/* The bloom is set inline from the column's own hue; the class exists so the
   reduced-motion preference can drop it without a second inline style. */
.drop-bloom {
  box-shadow: 0 0 10px var(--drop-hue);
}

@media (prefers-reduced-motion: reduce) {
  .drop-bloom {
    box-shadow: none;
  }
}
```

In `components/board/board-column.tsx`, add `Fragment` to the React import and `DropTarget` to the `@/lib/board-state` type import, then add above `BoardColumn`:

```tsx
function DropLine({ hue }: { hue: number }) {
  const color = flowColor(hue);
  return (
    <div
      data-testid="drop-indicator"
      aria-hidden
      className="drop-bloom relative h-[3px] rounded-full"
      style={{ background: color, ['--drop-hue' as string]: flowColor(hue, 0.6) }}
    >
      <span
        className="absolute -left-1 top-1/2 size-2 -translate-y-1/2 rounded-full"
        style={{ background: color }}
      />
      <span
        className="absolute -right-1 top-1/2 size-2 -translate-y-1/2 rounded-full"
        style={{ background: color }}
      />
    </div>
  );
}
```

Add `dropIndicator: DropTarget | null;` to the props type and `dropIndicator,` to the destructuring.

Replace the `cards.length === 0 ? … : …` block with:

```tsx
        {cards.length === 0 ? (
          dropIndicator ? (
            <div className="mt-3 px-1.5">
              <DropLine hue={hue} />
            </div>
          ) : (
            <p className="px-1.5 pt-6 text-sm text-muted">
              {filtering ? 'Nothing here matches' : 'Nothing here yet'}
            </p>
          )
        ) : (
          <SortableContext
            items={cards.map((card) => card.id)}
            strategy={verticalListSortingStrategy}
          >
            <ul className="mt-3 space-y-2 px-1.5">
              {cards.map((card) => (
                <Fragment key={card.id}>
                  {dropIndicator?.afterCardId === card.id ? (
                    <li>
                      <DropLine hue={hue} />
                    </li>
                  ) : null}
                  <li>
                    <BoardCard
                      card={card}
                      ringHue={rings.get(card.id)}
                      boardId={boardId}
                      canWrite={canWrite}
                      columns={columns}
                      labels={labels}
                      filtering={filtering}
                      onRename={(title) => onRenameCard(card, title)}
                      onDelete={() => onDeleteCard(card)}
                      onMoveTo={(toColumnId) => onMoveCardTo(card, toColumnId)}
                    />
                  </li>
                </Fragment>
              ))}
              {dropIndicator && dropIndicator.afterCardId === null ? (
                <li>
                  <DropLine hue={hue} />
                </li>
              ) : null}
            </ul>
          </SortableContext>
        )}
```

- [x] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run components/board/board-column.test.tsx > /tmp/t2.log 2>&1; echo "EXIT=$?"; tail -8 /tmp/t2.log`
Expected: EXIT=0, 7 passed. `pnpm typecheck` will still fail — `board-canvas.tsx` does not pass the new required prop yet. That is Task 3.

- [x] **Step 5: Commit**

```bash
git add components/board/board-column.tsx components/board/board-column.test.tsx app/globals.css
git commit -m "feat: draw the line where the card will land"
```

---

### Task 3: Track the target while the pointer moves

**Files:**
- Modify: `components/board/board-canvas.tsx`
- Test: `e2e/board-dnd.spec.ts`

**Interfaces:**
- Consumes: `sameDropTarget`, `DropTarget` (Task 1); `BoardColumn`'s `dropIndicator` prop (Task 2).
- Produces: nothing further tasks import.

- [x] **Step 1: Write the failing test**

Append to `e2e/board-dnd.spec.ts`:

```ts
test('the line shows where the card will land, before it lands', async ({ page, context }) => {
  const { userId } = await seedSession(context);
  const boardId = await seedBoard(userId, 'Roadmap');
  const [ready, inProgress] = await boardColumns(boardId);
  await seedCard(ready.id, { boardId, createdById: userId, title: 'Dragged', rank: 'a0' });
  await seedCard(inProgress.id, { boardId, createdById: userId, title: 'Sitting', rank: 'a0' });

  try {
    await page.goto(`/boards/${boardId}`);

    const target = page.locator(`[data-column-id="${inProgress.id}"]`);
    await expect(target.getByTestId('drop-indicator')).toHaveCount(0);

    const card = page.locator('[data-card-id]').filter({ hasText: 'Dragged' });
    await card.hover();
    await page.mouse.down();
    await page.mouse.move(0, 0);
    await expect(card).toHaveAttribute('style', /translate3d/);

    // Hover the card already sitting in the target column, so the line has a
    // neighbour to sit above rather than falling to the foot of the column.
    await target.locator('[data-card-id]').filter({ hasText: 'Sitting' }).hover();

    // The line exists while the pointer is still down. This is the whole
    // point of the section: today nothing renders until the drop.
    await expect(target.getByTestId('drop-indicator')).toBeVisible();
    await expect(page.getByTestId('drop-indicator')).toHaveCount(1);

    const moved = written(page);
    await page.mouse.up();
    await moved;

    // Where the line was is where the card went: it sat above 'Sitting', and
    // the card lands above 'Sitting'. One function decides both.
    await expect(target.getByTestId('card-title')).toHaveText(['Dragged', 'Sitting']);
    await expect(page.getByTestId('drop-indicator')).toHaveCount(0);
  } finally {
    await removeSeededUser(userId);
  }
});
```

Also append the two cases where a line must never appear. Both are guarded by the same mechanism —
`useSortable` is disabled, so no drag ever starts and `onDragOver` never fires — but the spec asks
for them proven rather than reasoned:

```ts
test('a viewer never sees a drop indicator', async ({ page, context }) => {
  const owner = await seedSession(context);
  const boardId = await seedBoard(owner.userId, 'Roadmap');
  const [ready] = await boardColumns(boardId);
  await seedCard(ready.id, { boardId, createdById: owner.userId, title: 'Fixed', rank: 'a0' });
  const viewer = await seedSession(context);
  await seedMember(boardId, viewer.userId, 'viewer');

  try {
    await page.goto(`/boards/${boardId}`);
    const card = page.locator('[data-card-id]').filter({ hasText: 'Fixed' });
    await card.hover();
    await page.mouse.down();
    await page.mouse.move(0, 0);
    await page.locator(`[data-column-id="${ready.id}"]`).hover();

    await expect(page.getByTestId('drop-indicator')).toHaveCount(0);
    await page.mouse.up();
  } finally {
    await removeSeededUser(viewer.userId);
    await removeSeededUser(owner.userId);
  }
});

// A filtered board disables dragging, because neighbours read from a filtered
// list put the card between two cards the user cannot see. No drag, no line.
test('a filtered board never sees a drop indicator', async ({ page, context }) => {
  const { userId } = await seedSession(context);
  const boardId = await seedBoard(userId, 'Roadmap');
  const [ready] = await boardColumns(boardId);
  const cardId = await seedCard(ready.id, {
    boardId,
    createdById: userId,
    title: 'Fixed',
    rank: 'a0',
  });
  const labelId = await seedLabel(boardId, 'bug');
  await assignLabel(cardId, labelId);

  try {
    // The param is `label`, repeated — parseLabelFilter reads getAll('label').
    await page.goto(`/boards/${boardId}?label=${labelId}`);

    const card = page.locator('[data-card-id]').filter({ hasText: 'Fixed' });
    await expect(card).toBeVisible();
    await card.hover();
    await page.mouse.down();
    await page.mouse.move(0, 0);
    await page.locator(`[data-column-id="${ready.id}"]`).hover();

    await expect(page.getByTestId('drop-indicator')).toHaveCount(0);
    await page.mouse.up();
  } finally {
    await removeSeededUser(userId);
  }
});
```

Add `seedLabel`, `assignLabel` and `seedMember` to the existing `./support/session` import. Their
signatures, checked rather than assumed: `seedMember(boardId, userId, role)` returns nothing,
`seedLabel(boardId, name)` returns the label id as a bare string, `assignLabel(cardId, labelId)`
returns nothing, and `seedCard(columnId, opts)` returns the card id.

- [x] **Step 2: Run test to verify it fails**

Run: `pnpm exec playwright test e2e/board-dnd.spec.ts --reporter=line > /tmp/t3.log 2>&1; echo "EXIT=$?"; tail -12 /tmp/t3.log`
Expected: FAIL — the indicator is never visible, because nothing tracks the pointer. Compare the number that ran against the number collected.

- [x] **Step 3: Write minimal implementation**

In `components/board/board-canvas.tsx`, add `type DragOverEvent` to the `@dnd-kit/core` type imports, and `dropTarget` is already imported. Add `sameDropTarget` and `type DropTarget` to the `@/lib/board-state` import.

Add state beside `draggingId`:

```tsx
  const [target, setTarget] = useState<DropTarget | null>(null);
```

Replace `onDragStart` and `onDragEnd`'s opening, and add `onDragOver`:

```tsx
  function onDragStart({ active }: DragStartEvent) {
    setDraggingId(String(active.id));
  }

  // onDragOver fires continuously, and every setState here re-renders every
  // column. Only a target that actually differs is worth a render.
  function onDragOver({ active, over }: DragOverEvent) {
    const next = over ? dropTarget(state, String(active.id), String(over.id)) : null;
    setTarget((current) => (sameDropTarget(current, next) ? current : next));
  }

  function onDragEnd({ active, over }: DragEndEvent) {
    setDraggingId(null);
    setTarget(null);
    if (!over || !canWrite) return;
    // ...unchanged from here
```

Add to the `DndContext`:

```tsx
        onDragOver={onDragOver}
        onDragCancel={() => {
          setDraggingId(null);
          setTarget(null);
        }}
```

Pass the indicator to each column, target only:

```tsx
                dropIndicator={target?.toColumnId === column.id ? target : null}
```

- [x] **Step 4: Run test to verify it passes**

Run: `pnpm exec playwright test e2e/board-dnd.spec.ts --reporter=line > /tmp/t3.log 2>&1; echo "EXIT=$?"; tail -6 /tmp/t3.log`
Expected: EXIT=0, 5 passed of 5 collected.

Then: `pnpm typecheck > /tmp/tc.log 2>&1; echo "EXIT=$?"` — expected 0, since the required prop now has a value at its only call site.

- [x] **Step 5: Commit**

```bash
git add components/board/board-canvas.tsx e2e/board-dnd.spec.ts
git commit -m "feat: follow the pointer, and say where the card would go"
```

---

### Task 4: The hole becomes a slot

**Files:**
- Modify: `components/board/board-card.tsx:136-143`
- Modify: `app/globals.css`
- Test: `components/board/board-card.test.tsx`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: nothing. The `useSortable` mock in `board-card.test.tsx` gains an `isDragging` override.

- [x] **Step 1: Write the failing test**

In `components/board/board-card.test.tsx`, replace the static `useSortable` mock with one that can be steered, at the top of the file:

```tsx
const dragging = { current: false };
vi.mock('@dnd-kit/sortable', () => ({
  useSortable: () => ({
    attributes: {},
    listeners: {},
    setNodeRef: () => {},
    transform: null,
    transition: undefined,
    get isDragging() {
      return dragging.current;
    },
  }),
}));
```

Append:

```tsx
describe('the card being dragged', () => {
  afterEach(() => {
    dragging.current = false;
  });

  test('at rest it is a surface with a border', () => {
    const html = render();
    expect(html).toContain('bg-surface');
    expect(html).not.toContain('bg-slot');
  });

  test('while dragging it becomes a slot, not a faded card', () => {
    dragging.current = true;
    const html = render();
    expect(html).toContain('bg-slot');
    expect(html).toContain('inset');
    // The old treatment. A 40% card still reads as a card.
    expect(html).not.toContain('opacity-40');
  });

  // The border is kept and made transparent rather than removed: dropping a
  // 1px border changes the box height, and a column must not reflow mid-drag.
  test('the slot keeps the border box it had', () => {
    dragging.current = true;
    expect(render()).toContain('border-transparent');
  });

  test('the slot hides the content without unmounting it', () => {
    dragging.current = true;
    const html = render();
    expect(html).toContain('invisible');
    expect(html).toContain('Fix the rank tie-break');
  });
});
```

Add `afterEach` to the `vitest` import.

- [x] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run components/board/board-card.test.tsx > /tmp/t4.log 2>&1; echo "EXIT=$?"; tail -20 /tmp/t4.log`
Expected: FAIL — `bg-slot` does not exist, `opacity-40` still does.

- [x] **Step 3: Write minimal implementation**

In `app/globals.css`, add to `:root`:

```css
  --slot: #D5DBE4;
```

to `[data-theme="dark"]`:

```css
  --slot: #0B0E13;
```

and to `@theme inline`:

```css
  --color-slot: var(--slot);
```

In `components/board/board-card.tsx`, replace the `<article>`'s `className` and wrap the content. The article becomes:

```tsx
      className={`card-enter group relative rounded-[var(--radius-card)] border px-3 py-2.5 transition-shadow duration-200 ${
        // The card in flight is carried by the overlay; what is left behind is
        // the socket it came out of, so it reads as absence rather than as a
        // faded second copy. The border stays and turns transparent — removing
        // it would change the box height and reflow the column mid-drag.
        isDragging
          ? 'border-transparent bg-slot shadow-[inset_0_1px_3px_rgb(0_0_0/0.45)]'
          : 'border-line bg-surface shadow-[0_1px_2px_rgb(0_0_0/0.04)]'
      }`}
```

Wrap the existing children — the `<h3>`, `DueDate`, `LabelLine`, `AttachmentCount` and `CardMenu` — in:

```tsx
      <div className={isDragging ? 'invisible' : undefined}>
```

- [x] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run components/board/board-card.test.tsx > /tmp/t4.log 2>&1; echo "EXIT=$?"; tail -8 /tmp/t4.log`
Expected: EXIT=0.

- [x] **Step 5: Commit**

```bash
git add components/board/board-card.tsx components/board/board-card.test.tsx app/globals.css
git commit -m "feat: leave a socket behind, not a ghost"
```

---

### Task 5: The card in flight carries its face and its origin

The overlay renders the title alone in a hardcoded 288px box. It should be the card, and it should say which column it left.

**Files:**
- Modify: `components/board/board-card.tsx`
- Modify: `components/board/board-canvas.tsx:575-588`
- Test: `components/board/board-card.test.tsx`

**Interfaces:**
- Consumes: `flowHue` (already imported by the canvas), `StateCard`, `BoardLabel`.
- Produces: `export function CardFace({ card, labels }: { card: StateCard; labels: BoardLabel[] })` from `components/board/board-card.tsx` — title, due date, label line and attachment count, with no link, no menu and no sortable wiring. `BoardCard` renders it; the overlay renders it.

- [x] **Step 1: Write the failing test**

Append to `components/board/board-card.test.tsx`:

```tsx
const { CardFace } = await import('./board-card');

describe('the face carried by the drag overlay', () => {
  const withMeta = { ...card, dueDate: '2026-09-05', attachmentCount: 2 };

  test('it is the card, not a label for it', () => {
    const html = renderToStaticMarkup(<CardFace card={withMeta} labels={labels} />);
    expect(html).toContain('Fix the rank tie-break');
    expect(html).toContain('bug · blocked');
    expect(html).toContain('2 attachments');
  });

  // The overlay is aria-hidden and sits outside the board's own DOM order, so
  // a link inside it is a duplicate target for keyboard and screen readers.
  test('it carries no link and no menu', () => {
    const html = renderToStaticMarkup(<CardFace card={withMeta} labels={labels} />);
    expect(html).not.toContain('<a ');
    expect(html).not.toContain('<button');
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run components/board/board-card.test.tsx > /tmp/t5.log 2>&1; echo "EXIT=$?"; tail -20 /tmp/t5.log`
Expected: FAIL — `CardFace` is not exported.

- [x] **Step 3: Write minimal implementation**

In `components/board/board-card.tsx`, add above `BoardCard`:

```tsx
export function CardFace({ card, labels }: { card: StateCard; labels: BoardLabel[] }) {
  return (
    <>
      <h3 data-testid="card-title" className="text-sm font-medium leading-5 text-ink">
        {card.title}
      </h3>
      {card.dueDate ? <DueDate value={card.dueDate} /> : null}
      <LabelLine ids={card.labelIds} labels={labels} />
      <AttachmentCount count={card.attachmentCount} />
    </>
  );
}
```

`BoardCard` keeps its own markup — its title is a `Link` and carries `pr-6` for the menu, which `CardFace` deliberately does not.

In `components/board/board-canvas.tsx`, import `CardFace` alongside nothing else new, and replace the `DragOverlay` body:

```tsx
        <DragOverlay dropAnimation={null}>
          {dragging ? (
            <article
              aria-hidden
              className="rounded-[var(--radius-card)] border bg-surface px-3 py-2.5 shadow-[0_20px_34px_-10px_rgb(0_0_0/0.75)]"
              style={{
                width: CARD_WIDTH,
                // The hue of the column it came from, so a card in flight
                // carries its origin rather than borrowing the one under it.
                borderColor: flowColor(
                  flowHue(
                    columns.findIndex((column) => column.id === dragging.columnId),
                    total,
                  ),
                ),
                transform: reducedMotion ? undefined : 'scale(1.02) rotate(3deg)',
              }}
            >
              <CardFace card={dragging} labels={state.labels} />
            </article>
          ) : null}
        </DragOverlay>
```

Add `flowColor` to the `@/lib/flow` import. Replace the hardcoded `288` by declaring, beside `REDUCED` at module scope:

```tsx
// The overlay is not inside a column, so it cannot inherit the card width and
// has to be told. Kept beside the column width it is derived from: 300px of
// column less the 6px of body padding on each side.
const CARD_WIDTH = 288;
```

- [x] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run components/board/board-card.test.tsx > /tmp/t5.log 2>&1; echo "EXIT=$?"; tail -8 /tmp/t5.log`
Expected: EXIT=0.

Then: `pnpm typecheck > /tmp/tc.log 2>&1; echo "EXIT=$?"` — expected 0.

- [x] **Step 5: Commit**

```bash
git add components/board/board-card.tsx components/board/board-canvas.tsx components/board/board-card.test.tsx
git commit -m "feat: carry the whole card, and the colour it came from"
```

---

### Task 6: Section A pull request

- [x] **Step 1: Check the drag by hand, in both themes**

Run `pnpm dev`, open a board with cards in two columns. Drag across columns and confirm: the line appears in the target column at the position the card lands, the source card is a sunken slot, the overlay carries the due date and labels and is bordered in the source column's hue. Switch theme from the account menu and repeat. Screenshot both for the PR.

- [x] **Step 2: Check the keyboard drag**

Tab to a card, press space, arrow to another column, confirm the line appears without a pointer, press space to drop. This needs no code — it is the claim that `over` is set by the keyboard sensor, and it is unverified until observed.

- [x] **Step 3: Check reduced motion**

With the OS set to reduce motion, confirm the overlay does not tilt or scale and the line has no bloom.

- [x] **Step 4: Run the gates**

Run: `pnpm typecheck > /tmp/t.log 2>&1; echo "TYPECHECK=$?"; pnpm lint > /tmp/l.log 2>&1; echo "LINT=$?"; pnpm test > /tmp/v.log 2>&1; echo "TEST=$?"; pnpm build > /tmp/b.log 2>&1; echo "BUILD=$?"; pnpm exec playwright test --reporter=line > /tmp/e.log 2>&1; echo "E2E=$?"; tail -3 /tmp/e.log`
Expected: all five EXIT=0. Compare the number that ran against the number collected. Attachment specs fail locally without `S3_ENDPOINT` and a bucket — if that is the only failure, say so explicitly and let CI be the green run.

- [x] **Step 5: Update `CLAUDE.md`**

In "Drag and drop", after the bullet about the server action receiving ids rather than an index, add:

```markdown
- The drop target is **drawn**, not merely computed. `onDragOver` records `over.id`, and
  `dropTarget` — the same function `onDragEnd` calls to decide the real move — turns it into the
  line rendered in the target column. There is deliberately no second "where would this land"
  helper: a parallel calculation is a thing that can disagree with the drop, and this one cannot.
  `onDragOver` fires when the droppable under the pointer *changes*, not on every frame —
  `@dnd-kit/core@6.3.1` runs it from an effect keyed on `over.id`. `sameDropTarget` still earns
  its place, because two different `over` ids resolve to the same target more often than not (a
  column's own id and its last card both mean "after the last card"), and a `setTarget` here
  re-renders every column.
- A card being dragged leaves a **slot**, not a hole. The source card keeps its border and its box
  height, recolours that border to transparent, paints `--slot`, and hides its content with
  `invisible` rather than unmounting it — so the column does not reflow as the drag starts. Its
  title is therefore present but not visible mid-drag: `toHaveText` still matches it, `toBeVisible`
  does not.
```

- [x] **Step 6: Tick this section's boxes, commit, open the PR**

```bash
git add CLAUDE.md docs/plans/board-legibility.md
git commit -m "docs: record that the drop target is drawn"
git push -u origin feat/board-legibility-drag
gh pr create --base main --title "feat: board legibility Section A — the drag reads"
```

The body states the spec and section, what was verified with observed output, and carries the screenshots. No migration in this section.

- [ ] **Step 7: Stop and hand back**

Section B starts in a fresh session, from `main`, once this has merged.

---

# Section B — the column has a body

Branch: `feat/board-legibility-columns`, from `main` once A has landed. Confirm the base is real before starting:

```bash
git merge-base --is-ancestor origin/feat/board-legibility-drag origin/main
```

### Task 7: The well, the panel, and the header that stops scrolling

The header currently lives inside the `overflow-y-auto` element (`board-column.tsx:95-113`, inside the scrolling `div` opened at line 90), so scrolling a long column takes the column's name away while the wash — painted on the scroll container's own box — stays. That contradicts `CLAUDE.md`: *"Hue is never the only signal — column names are always visible."* This is a defect, and the test for it is structural so a later refactor cannot silently undo it.

**Files:**
- Modify: `components/board/board-column.tsx`
- Modify: `app/globals.css`
- Test: `components/board/board-column.test.tsx`

**Interfaces:**
- Consumes: everything from Section A.
- Produces: no new props. `--well` becomes available as `bg-well`.

- [ ] **Step 1: Write the failing test**

Append to `components/board/board-column.test.tsx`:

```tsx
describe('the column body', () => {
  test('the column sits on a well of its own', () => {
    expect(render()).toContain('bg-well');
  });

  // The defect this fixes: the header used to live inside the scrolling
  // element, so a long column scrolled its own name out of view and left the
  // hue behind. CLAUDE.md requires the name to be visible whenever the hue is.
  test('the header is not inside the scrolling element', () => {
    const html = render();
    const scroller = html.indexOf('overflow-y-auto');
    const name = html.indexOf('data-testid="column-name"');
    expect(name).toBeGreaterThan(-1);
    expect(scroller).toBeGreaterThan(-1);
    expect(name).toBeLessThan(scroller);
  });

  // The droppable must stay on the scrolling body: the empty area below the
  // last card is a drop target, and moving the ref would change which element
  // answers a drop.
  test('the cards still scroll', () => {
    expect(render()).toContain('overflow-y-auto');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run components/board/board-column.test.tsx > /tmp/t7.log 2>&1; echo "EXIT=$?"; tail -20 /tmp/t7.log`
Expected: FAIL — no `bg-well`, and the name appears *after* `overflow-y-auto` in the markup.

- [ ] **Step 3: Write minimal implementation**

In `app/globals.css`, add to `:root`:

```css
  --well: #E3E8F0;
```

to `[data-theme="dark"]`:

```css
  --well: #131820;
```

and to `@theme inline`:

```css
  --color-well: var(--well);
```

The well is a neutral trough that sits **lighter** than the canvas in dark and **darker** in light, because cards are already pure white there. Both directions read the same way: the card floats above its column.

In `components/board/board-column.tsx`, replace the whole `<section>` body. The section keeps the width and becomes pure geometry; the panel carries the surface; the header sits in the panel above the scroller. Note the gutter is now a real gap (`min-[700px]:pr-3`) rather than inset padding, and the panel fills the width below 700px:

```tsx
    <section
      ref={ref}
      data-column-id={column.id}
      className="flex h-full w-screen shrink-0 snap-start flex-col min-[700px]:w-[312px] min-[700px]:snap-align-none min-[700px]:pr-3"
    >
      <div className="flex min-h-0 flex-1 flex-col bg-well min-[700px]:rounded-b-xl">
        <div
          className="h-[3px] shrink-0"
          style={{ background: `linear-gradient(90deg, ${flowColor(hue)}, ${flowColor(nextHue)})` }}
        />
        <div
          className="flex shrink-0 items-center gap-1 px-1.5 pb-2 pt-3"
          style={{ background: `linear-gradient(${flowColor(hue, 0.06)}, transparent 80px)` }}
        >
          <h2
            data-testid="column-name"
            className="min-w-0 flex-1 truncate text-xs font-semibold uppercase tracking-[0.08em] text-muted"
          >
            {column.name}
          </h2>
          {canWrite ? (
            <ColumnMenu
              column={column}
              isFirst={isFirst}
              isLast={isLast}
              onRename={(name) => onRenameColumn(column, name)}
              onAddAfter={(name) => onAddColumnAfter(column, name)}
              onMove={(direction) => onMoveColumn(column, direction)}
              onDelete={onDeleteColumn ? () => setDeleting(true) : null}
            />
          ) : null}
        </div>
        {/* The droppable is the scrolling body, not the section, so the empty
            area below the last card is a drop target too. */}
        <div ref={setNodeRef} className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-4">
          {/* Move the existing `cards.length === 0 ? … : …` block here verbatim,
              including the SortableContext, the DropLine placements from Task 2 and
              the AddCard block. Nothing inside it changes. */}
        </div>
      </div>
      {/* The existing DeleteColumnDialog block stays exactly where it is, a direct
          child of the section and outside the panel. Nothing inside it changes. */}
    </section>
```

The wash moves onto the header, where it is now 80px of a much shorter element; keep the 80px falloff so the value in `CLAUDE.md` stays true.

**The header is inset 6px (`px-1.5`), matching the scroller and the card list, and that is
load-bearing arithmetic rather than taste.** The section is 312px and now spends 12px of it on a
real gutter, so the panel is 300px. The scroller and the `ul` each add `px-1.5`, which is 12px a
side, leaving cards at **276px, not the 288px they are today.** The panel lost 12px to the new
gutter and nothing else changed to compensate, so the card width moves with it: 300 − 12 − 12 =
276. **`CARD_WIDTH` in the overlay must be re-derived — updated to 276, or better, read from the
dragged node's measured rect rather than left as a literal** — or the card in flight is 12px wider
than the slot it left. Do not carry the "288px, unchanged" claim into the implementation; it was
checked against the wrong panel width. Insetting the header further would misalign it against the
cards for no gain.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run components/board/board-column.test.tsx > /tmp/t7.log 2>&1; echo "EXIT=$?"; tail -8 /tmp/t7.log`
Expected: EXIT=0, 10 passed.

- [ ] **Step 5: Commit**

```bash
git add components/board/board-column.tsx components/board/board-column.test.tsx app/globals.css
git commit -m "feat: give the column a body, and keep its name in sight"
```

---

### Task 8: The card count

**Files:**
- Modify: `components/board/board-column.tsx`
- Test: `components/board/board-column.test.tsx`

**Interfaces:** none new.

- [ ] **Step 1: Write the failing test**

Append to `components/board/board-column.test.tsx`:

```tsx
describe('the card count', () => {
  test('the header says how many cards the column holds', () => {
    expect(render()).toContain('data-testid="column-count"');
    const html = render();
    const start = html.indexOf('data-testid="column-count"');
    expect(html.slice(start, html.indexOf('</span>', start))).toContain('2');
  });

  // It counts what is on screen: a filtered column showing one card that says
  // "2" is describing a board the reader cannot see.
  test('a filtered column counts what is shown', () => {
    const html = render({ cards: [cards[0]], filtering: true });
    const start = html.indexOf('data-testid="column-count"');
    expect(html.slice(start, html.indexOf('</span>', start))).toContain('1');
  });

  test('an empty column counts zero', () => {
    const html = render({ cards: [] });
    const start = html.indexOf('data-testid="column-count"');
    expect(html.slice(start, html.indexOf('</span>', start))).toContain('0');
  });

  // wipLimit was dropped from the schema deliberately. This is a plain count:
  // no limit, no threshold, and no warm hue, which is reserved for time and
  // destructive actions.
  test('the count carries no colour of its own', () => {
    const html = render();
    const start = html.indexOf('data-testid="column-count"');
    const span = html.slice(start, html.indexOf('</span>', start));
    expect(span).toContain('font-mono');
    expect(span).not.toContain('text-time-');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run components/board/board-column.test.tsx > /tmp/t8.log 2>&1; echo "EXIT=$?"; tail -20 /tmp/t8.log`
Expected: FAIL — no `column-count` element.

- [ ] **Step 3: Write minimal implementation**

In the header, between the `<h2>` and the `ColumnMenu`:

```tsx
          <span data-testid="column-count" className="font-mono text-xs text-muted">
            {cards.length}
          </span>
```

`cards` is already the filtered array the column renders, so the count matches what is on screen without further work.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run components/board/board-column.test.tsx > /tmp/t8.log 2>&1; echo "EXIT=$?"; tail -8 /tmp/t8.log`
Expected: EXIT=0, 14 passed.

- [ ] **Step 5: Commit**

```bash
git add components/board/board-column.tsx components/board/board-column.test.tsx
git commit -m "feat: say how many cards a column is holding"
```

---

### Task 9: The receiving column arms itself

**Files:**
- Modify: `components/board/board-column.tsx`
- Test: `components/board/board-column.test.tsx`

**Interfaces:** none new — the column already knows it is the target, because `dropIndicator` is non-null only there.

- [ ] **Step 1: Write the failing test**

Append to `components/board/board-column.test.tsx`:

```tsx
describe('the armed column', () => {
  test('a column that is not the target is not armed', () => {
    expect(render()).not.toContain('data-armed="true"');
  });

  test('the target column arms itself', () => {
    expect(render({ dropIndicator: indicator('c2') })).toContain('data-armed="true"');
  });

  // The ring is the column's own hue, so the arming says which column as well
  // as that one is armed at all.
  test('the ring is the column hue', () => {
    const html = render({ dropIndicator: indicator('c2'), hue: 185 });
    const start = html.indexOf('data-armed="true"');
    expect(html.slice(start - 400, start)).toContain('hsl(185 60% 45% / 0.45)');
  });

  // 6% at rest, 13% while armed. Same gradient at a different alpha, not a
  // second one: the band and the wash remain the whole gradient budget.
  test('the wash deepens while armed', () => {
    expect(render()).toContain('hsl(185 60% 45% / 0.06)');
    expect(render({ dropIndicator: indicator('c2') })).toContain('hsl(185 60% 45% / 0.13)');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run components/board/board-column.test.tsx > /tmp/t9.log 2>&1; echo "EXIT=$?"; tail -20 /tmp/t9.log`
Expected: FAIL — no `data-armed` attribute.

- [ ] **Step 3: Write minimal implementation**

In `components/board/board-column.tsx`, above the return:

```tsx
  const armed = dropIndicator !== null;
```

The panel gains the attribute, the ring and the lift. `--well-armed` is one step **away from the canvas** — brighter in dark, darker in light — because the well is an inverted token and a literal "brighten" would pull the light-mode well back toward the canvas:

```tsx
      <div
        data-armed={armed ? 'true' : undefined}
        className="flex min-h-0 flex-1 flex-col bg-well transition-colors duration-150 min-[700px]:rounded-b-xl"
        style={
          armed
            ? {
                background: 'var(--well-armed)',
                boxShadow: `inset 0 0 0 1px ${flowColor(hue, 0.45)}`,
              }
            : undefined
        }
      >
```

The header's wash reads the armed state:

```tsx
          style={{
            background: `linear-gradient(${flowColor(hue, armed ? 0.13 : 0.06)}, transparent ${
              armed ? 90 : 80
            }px)`,
          }}
```

and the name and count brighten:

```tsx
            className={`min-w-0 flex-1 truncate text-xs font-semibold uppercase tracking-[0.08em] ${
              armed ? 'text-ink' : 'text-muted'
            }`}
```

Apply the same conditional to the count's `text-muted`.

In `app/globals.css`, add to `:root`:

```css
  --well-armed: #D7DEE9;
```

and to `[data-theme="dark"]`:

```css
  --well-armed: #18202B;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run components/board/board-column.test.tsx > /tmp/t9.log 2>&1; echo "EXIT=$?"; tail -8 /tmp/t9.log`
Expected: EXIT=0, 18 passed.

- [ ] **Step 5: Commit**

```bash
git add components/board/board-column.tsx components/board/board-column.test.tsx app/globals.css
git commit -m "feat: light the column that is about to receive the card"
```

---

### Task 10: Card breathing room

**Files:**
- Modify: `components/board/board-card.tsx`
- Modify: `components/board/board-canvas.tsx`
- Test: `components/board/board-card.test.tsx`

**Interfaces:** none new.

- [ ] **Step 1: Write the failing test**

Append to `components/board/board-card.test.tsx`:

```tsx
describe('the card has room', () => {
  test('it is padded at 14px, not 12', () => {
    expect(render()).toContain('p-3.5');
  });

  // A title-only card and one carrying a due date, labels and an attachment
  // count should not differ wildly, so rows across columns broadly line up.
  test('it has a floor so ragged rows even out', () => {
    expect(render()).toContain('min-h-[58px]');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run components/board/board-card.test.tsx > /tmp/t10.log 2>&1; echo "EXIT=$?"; tail -20 /tmp/t10.log`
Expected: FAIL — the card is `px-3 py-2.5`.

- [ ] **Step 3: Write minimal implementation**

In `components/board/board-card.tsx`, replace `px-3 py-2.5` with `min-h-[58px] p-3.5` in the `<article>`'s className.

In `components/board/board-canvas.tsx`, apply the same padding to the overlay so the card in flight matches the one it left. **`CARD_WIDTH` must already have moved to 276 in Task 7** (or been replaced by a measured-rect width) — the card is 276px wide after Task 7's real gutter, not the 288px it was in Section A, and only its internal padding changes here.

```tsx
              className="rounded-[var(--radius-card)] border bg-surface p-3.5 shadow-[0_20px_34px_-10px_rgb(0_0_0/0.75)]"
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run components/board/board-card.test.tsx > /tmp/t10.log 2>&1; echo "EXIT=$?"; tail -8 /tmp/t10.log`
Expected: EXIT=0.

- [ ] **Step 5: Commit**

```bash
git add components/board/board-card.tsx components/board/board-canvas.tsx components/board/board-card.test.tsx
git commit -m "feat: give the cards room to breathe"
```

---

### Task 11: Section B pull request

- [ ] **Step 1: Check the board at 360px and at desktop width**

Run `pnpm dev`. At desktop width confirm the wells are separated by real gutters, the headers stay put when a column scrolls, and the counts are right. At 360px confirm the panel fills the width with no side gutter, and that dragging into the visible column arms it. Screenshot both themes and 360px.

- [ ] **Step 2: Confirm a long column keeps its name**

Seed or add enough cards to make a column scroll, then scroll it. The name and the ⋯ menu must not move. This is the defect the section exists to fix and it is not proven by a unit test alone.

- [ ] **Step 3: Run the gates**

Run: `pnpm typecheck > /tmp/t.log 2>&1; echo "TYPECHECK=$?"; pnpm lint > /tmp/l.log 2>&1; echo "LINT=$?"; pnpm test > /tmp/v.log 2>&1; echo "TEST=$?"; pnpm build > /tmp/b.log 2>&1; echo "BUILD=$?"; pnpm exec playwright test --reporter=line > /tmp/e.log 2>&1; echo "E2E=$?"; tail -3 /tmp/e.log`
Expected: all five EXIT=0, the number that ran equal to the number collected.

`e2e/board-responsive.spec.ts` and `e2e/columns.spec.ts` exercise the column and must stay green — the markup around `data-column-id` and `column-name` changed shape, so a failure there is this section's doing, not a flake.

- [ ] **Step 4: Update `CLAUDE.md`**

Three edits, all in the same commit as the work:

1. **"Signature: the flow spectrum"** — the first bullet promises the rules "side by side ... form one unbroken band across the board." Replace with:

```markdown
- A 3px rule at the top of each column, gradient from its own hue to the next column's. The rules
  cap each column's own panel rather than meeting edge to edge: columns are separated by a real
  12px gutter so each has a visible body, and the band is one cap per column. This was traded
  deliberately — a column you can see the edges of is a drop target you can aim at, and the
  spectrum still reads because the hue derives from position and re-interpolates with the column
  count. `app/design`'s proof sheet has always rendered the spectrum gapped; the board now
  matches it.
```

2. **"Tokens"** — add under `--line`:

```markdown
--well        #131820 / #E3E8F0     the column's own body, under its cards
--well-armed  #18202B / #D7DEE9     that body while it is the drop target
--slot        #0B0E13 / #D5DBE4     the socket a dragged card left behind
```

with a line noting that `--well` is an inverted token: lighter than the canvas in dark, darker in light, because cards are already pure white there. `--slot` does not invert — cards are lighter than their well in both themes, so "away from the card" is downward in both.

3. **"UI conventions"** — the "Columns are 300px fixed width with 12px gutters" line is now literally true rather than simulated by inset padding. Say so, and drop the stale explanation from `board-column.tsx`'s top comment in the same change.

- [ ] **Step 5: Tick this section's boxes, commit, open the PR**

```bash
git add CLAUDE.md docs/plans/board-legibility.md
git commit -m "docs: record the column well and the band it costs"
git push -u origin feat/board-legibility-columns
gh pr create --base main --title "feat: board legibility Section B — the column has a body"
```

No migration in this section either.

---

## Verification, carried from the spec

Ticked only against observed output.

- [x] `pnpm typecheck && pnpm lint && pnpm test && pnpm build`, each exit code read directly rather than through a pipe.
- [ ] `pnpm test:e2e` passes, with the number that ran compared against the number collected.
- [x] A cross-column drag shows the line in the target column, observed by hand, in both themes.
- [x] A keyboard drag shows the same line, observed by hand.
- [ ] At 360px, dragging into the visible column arms it, observed by hand.
- [x] `prefers-reduced-motion` drops the tilt, the scale and the bloom, observed by hand.
- [ ] A column long enough to scroll keeps its name and menu in place, observed by hand.
- [ ] Screenshots of a drag in progress, both themes and at 360px, attached to the PRs.

## Notes carried from brainstorming

- **The indicator is `dropTarget` rendered, not a new calculation.** Any future "where would this land" helper is a bug waiting to disagree with the drop.
- **Sibling shifting stays.** `verticalListSortingStrategy` keeps opening a gap within a column; the line is drawn into the gap rather than fighting it.
- **The board does not dim during a drag.** Rejected: it re-lights the whole board on every crossing and hides the context the card is being dragged relative to.
- **The well is neutral, not hue-tinted.** Rejected: a tinted well puts colour at rest across the whole board.
- **The band is broken on purpose.** Not a regression to be fixed later.
