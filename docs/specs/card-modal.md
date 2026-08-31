# Spec: Card modal

Status: drafted, awaiting review
Date: 2026-08-31
Sub-project: 5 of 7

## Goal

A card stops being a title. It opens — over the board when you click it, as a
page when you follow a link — and carries a description, a due date and a
conversation. This is also the sub-project where the app's warm colour is used
for the first time, because a due date is the first thing on the board that can
be late.

Sub-project 6 inherits every mutation here as a `publish()` call site, and a
`comments` table whose payloads are already capped to fit under Pusher's 10KB
message limit.

## Non-goals

**No realtime.** Every action in this sub-project is a candidate `publish()`
call site in sub-project 6 and none of them make one. A teammate's comment
appears on their next load, exactly as sub-projects 3 and 4 already accepted.

**No labels, attachments or activity log.** They are `CLAUDE.md` open decisions,
not deferred work with a design behind them.

**No invite flow.** It is still sub-project 7's, so no board gains a second
member through the UI. The author-only comment rules are enforced and tested
regardless — the tests seed a second member directly, as sub-project 4's viewer
tests already do — but nobody will meet them by using the app until invites
land.

**No `@mentions`, no markdown rendering, no rich text.** A comment is plain text
in a textarea. Rendering user-authored markup is a security question with its own
design, and nothing here needs it.

**No account deletion UI.** `/privacy` says deletion happens by email today, and
this sub-project only makes sure the schema can honour what that page already
promises.

## Deliverables

### The route pair, and a correction to `CLAUDE.md`

`CLAUDE.md`'s Layout section is internally inconsistent and one half of it has to
give. It shows the intercept as `@card/(.)cards/[cardId]` while placing the
canonical page at `/cards/[cardId]`, two route segments higher. Next's
convention counts **route segments**, and neither slots nor route groups are
segments — so `(.)`, "same level", cannot reach a root-level `cards`. The
failure mode is the dangerous kind: no error, no warning, just a full-page
navigation where a modal was expected.

**Resolved in favour of the marker: the canonical page moves under the board.**

```
app/(app)/(board)/boards/[boardId]/
  layout.tsx                        # gains a `card` slot prop beside children
  @card/
    default.tsx                     # returns null
    (.)cards/[cardId]/page.tsx      # intercepted → CardBody in a dialog
  cards/[cardId]/page.tsx           # canonical → CardBody, full page
```

Both `cards/[cardId]` folders are children of `boards/[boardId]`, which makes
this the same-level case the Next docs actually document, rather than the
least-travelled `(..)(..)` across two route groups. The URL grows a board id;
what it buys is that the one framework feature here whose failure is silent runs
in its documented configuration.

`CLAUDE.md`'s Layout tree and its "what a shared link opens on a cold load" line
both change in the same PR that builds this, per the rule that this file stays
current.

The behaviour, which falls out of the framework rather than out of a flag:

- **Soft navigation** from the board fills `@card` and leaves `children` on the
  canvas, so the board stays mounted and its reducer stays alive behind the
  modal.
- **Browser-back** closes the modal, because closing it is a navigation, not a
  state change.
- **A hard load** of `/boards/x/cards/y` does not intercept. `@card` is unmatched
  and falls to `default.tsx`, and the canonical page renders alone.
- `@card/default.tsx` is **required**, not tidiness: an unmatched slot with no
  default renders a 404, so without it a hard load of the plain board breaks.

Both pages resolve the board from the card row through the existing
`boardIdForCard` and call `assertBoardAccess` independently — `CLAUDE.md` requires
every entry point to re-check rather than trust a parent — and both `notFound()`
on a membership miss, so a guessed card id is never confirmed as real. A new
`lib/cards.ts` holds the read, `cache`d per request exactly as
`getBoardWithColumns` is.

One client `CardBody` serves both entry points. It differs only in how it closes:
intercepted it calls `router.back()`, canonical it navigates to the board.

### The `comments` table, and a promise already published

```ts
export const comments = pgTable(
  'comments',
  {
    id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
    cardId: text('card_id')
      .notNull()
      .references(() => cards.id, { onDelete: 'cascade' }),
    // Nullable, and set null rather than cascade. See below.
    authorId: text('author_id').references(() => users.id, { onDelete: 'set null' }),
    body: text('body').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [index('comments_card_id_created_at_idx').on(t.cardId, t.createdAt)],
);
```

`cardId` cascades: a deleted card takes its conversation with it, and unlike a
column's cards there is nothing meaningful to move them to.

**`authorId` is nullable and sets null, because `/privacy` already promises it.**
The live policy page says, in `app/(legal)/privacy/page.tsx`:

> we will delete your account, the boards you own, and your comments. Boards
> owned by other people that you contributed to will keep your comments unless
> you ask for those too.

A cascade makes that unkeepable — deleting the account would take every comment
everywhere, and the sentence becomes false the first time anyone acts on it.
`set null` keeps the comment and drops the person, which is also `CLAUDE.md`'s
own "anonymises or removes" wording. The cost is real and is accepted: every
comment render handles a null author, showing a neutral "Deleted account" with no
avatar, because there is no id left to hash a colour from.

It also settles a permission question without a second rule: a comment with no
author can be edited and deleted by nobody.

**Fixed here, not left alone.** `cards.createdById` cascaded from `users`, so
deleting an account would delete every card that person created on other
people's boards — and, because this sub-project also makes `comments.cardId`
cascade from `cards`, every comment on those cards too, including comments left
by people who never touched their own account. That second half is new: the
cascade only becomes a policy contradiction once comments cascade from cards,
and that cascade is this sub-project's doing, not something the app already
shipped. `cards.createdById` gets the same shape as `comments.authorId` above —
nullable, `set null` — for the same reason: a card a deleted user created lives
on, authorless, and its comments, including other people's, survive with it.

### Server actions

`lib/actions/cards.ts` grows two narrow actions beside its four. **The title
reuses `renameCard`** — the modal's title field calls the same action the `⋯`
menu already calls, which is one more call site and no second rule.

- `setCardDescription({ cardId, description })` — member
- `setCardDueDate({ cardId, dueDate })` — member

`lib/actions/comments.ts` is new, one module per aggregate as `CLAUDE.md`
requires:

- `addComment({ cardId, body })` — **any member, `viewer` included**
- `editComment({ commentId, body })` — author only
- `deleteComment({ commentId })` — author only

`viewer` commenting is not a relaxation invented here; `CLAUDE.md` grants viewers
read and comment. Both pages already `notFound()` anyone below `viewer`, so the
right to comment is established by reaching the page at all — there is no second
gate to compute. `canWrite` is the modal's only derived boolean, the same as the
canvas's, computed on the server and passed down, never a role the client
resolves — `lib/permissions.ts` imports `lib/db` and cannot be reached from a
client component.

Author-only resolves in one query through a new `commentScope(commentId)` in
`lib/actions/scope.ts`, returning `{ boardId, authorId }`. **The order is
load-bearing:**

```ts
const scope = await commentScope(parsed.data.commentId);
if (!scope) return { ok: false, error: 'NOT_FOUND' } as const;
await assertBoardAccess(session.user.id, scope.boardId, 'viewer');
if (scope.authorId !== session.user.id) return { ok: false, error: 'FORBIDDEN' } as const;
```

Membership is checked before authorship so that a non-member cannot distinguish
"not yours" from "not your board", which would confirm the comment exists.

Comments read **oldest first**, which is what the `(cardId, createdAt)` index
orders and what a conversation reads as. A new comment therefore appends to the
bottom, and that is where the optimistic row lands too.

Zod caps: description 10,000 characters, comment body 4,000, and a comment body
that trims to empty is `INVALID`. The caps exist because sub-project 6 has to fit
these payloads under Pusher's 10KB limit, and a bound chosen now is cheaper than
a truncation rule invented then.

### The due date is a calendar date in a `timestamptz`

Stated explicitly because the default behaviour is wrong by one day for most of
the world. The column is `timestamptz`; the value is a **calendar date**.

- **Store** midnight UTC of the chosen date.
- **Format** from the UTC parts. Rendering the stored instant in the viewer's
  zone shows the previous day everywhere west of Greenwich.
- **Compare** the stored calendar date against **the viewer's** today, because
  "overdue" is a question about the reader's day, not about an instant.

That comparison lives in a new pure `lib/due.ts` returning `plain | soon | over`
plus the mono `Nd over` label, which is unit-testable without a browser.

The threshold, which the brief left open: **rust once the date is before today,
amber for today and tomorrow, plain `--muted` mono beyond that.** Two days is
enough warning to act on without amber becoming the board's resting state — and
the brief is explicit that nothing warm is ever at rest on the board except a due
date that has earned it.

### Optimism, and what the card face learns

`StateCard` gains `dueDate: string | null`, `boardReducer` gains
`card.setDueDate`, and `inverse()` grows the matching case. Description never
appears on the card face and so touches no board state at all.

The modal and the canvas are **siblings**, not parent and child — `@card` and
`children` under one layout — so they can only meet through context. That context
already exists: `BoardActionsProvider` is rendered by the board layout and
therefore wraps both, and its `register` pattern already solves exactly this
problem for the top bar's "New card". It gains `patchCard` beside `addCard`,
registered by the canvas on mount.

This is also why the canonical page needs no special case: it is under the same
layout, reaches the same provider, and finds nothing registered because no canvas
is mounted.

**Comments are optimistic. Field edits are not.** Comment creation appends a
temp-id `pending` row, settles in place on the server id, and on rejection removes
it and says so — the same shape as card creation, which `CLAUDE.md` requires.
Title and due date instead push to the card face **on success**: the person is
looking at the field they are typing in, not at the card behind the modal, so
optimism there buys nothing visible and would cost a rollback path spanning two
component trees. Nothing a person is watching waits on the network.

Errors surface in a status strip owned by `CardBody`, so the canonical page has
one of its own rather than depending on the canvas's. The comment thread keeps a
second strip of its own, beside the composer: a comment that failed to post
belongs next to the box still holding its text, not at the top of a modal the
reader may have scrolled away from.

### The modal, at the level this spec decides

The design pass happens at implementation time with the `frontend-design` skill,
per `CLAUDE.md`. What is fixed here is only what the brief already decided:

- Modal radius 16, `--surface` over the board, `--line` borders.
- The title edits at the **card-title scale, not display** — display "never
  appears on a card", and this is a card.
- Description is body 15/24 in a textarea; both title and description **commit on
  blur**, with Escape reverting. No Save button, because the modal closes by
  browser-back and a dirty-close guard would have to fight it. A rejected commit
  puts the field back to its last saved value and says so in the strip — the same
  rule the canvas already applies to a rejected rename.
- Every date is mono, per the type scale's data role.
- The due date control is a native `<input type="date">`: no dependency, keyboard
  accessible without work, and formatted in the viewer's locale by the browser,
  which is what `CLAUDE.md` asks of dates. shadcn's calendar would add
  `react-day-picker` for one field on one surface.
- The due date is the app's **first warm colour**, and carries the mono `Nd over`
  label alongside its hue so that colour is never the only signal.

## Testing

Unit:

- `lib/due.ts` — the three states across the threshold boundaries, the `Nd over`
  label, and the UTC-parts rule proved against a zone west of Greenwich.
- `boardReducer` — `card.setDueDate` and its inverse.
- The comment permission matrix — a viewer may add; a member who is not the
  author may not edit or delete; a comment with a null author may be edited and
  deleted by nobody; an empty or over-length body is `INVALID`.

End to end:

- Clicking a card opens the modal **over a still-live board**, and the URL is
  `/boards/x/cards/y`.
- **Browser-back closes it** and the canvas is still there — not remounted.
- A **cold load** of that same URL renders the full page and no dialog. This is
  the half that fails silently, and it is why Section 1 is a spike.
- A title edited in the modal changes the card behind it.
- A description survives a reload.
- A due date set in the modal appears on the card face, and an overdue one is
  rust with its `Nd over` label.
- A `viewer` sees read-only fields **and a working comment box**.
- A second member cannot edit or delete someone else's comment — checked in the
  UI and by calling the action directly.
- A rejected comment rolls back and says so, **forced** rather than hoped for,
  the way sub-project 4's verification forced a rejected move.
- A due date renders the **same calendar date** it was set to when the browser is
  in a zone west of Greenwich.

## Sections and pull requests

One section, one branch, one PR, per `CLAUDE.md`.

1. **The routing spike.** Throwaway, deleted before the PR; the findings are the
   PR body. Proves `(.)` intercepts on soft navigation, that a hard load does
   not, and that `@card/default.tsx` is what stops a 404 on the plain board.
2. **The `comments` table.** Schema, migration, referential proof — that a
   deleted card takes its comments and a deleted user does not. Nothing
   user-visible, exactly as sub-project 4's Section A, so production can be
   hand-migrated well before the UI that needs it.
3. **The route pair and the card body.** Modal over the board, canonical page on
   cold load, title and description editing, `patchCard` write-through.
   `CLAUDE.md`'s Layout section is corrected in this PR.
4. **Due dates end to end.** `lib/due.ts`, the control in the modal, the date on
   the card face, the warm rule.
5. **Comments.** List, optimistic add, author-only edit and delete.

Due dates come after the modal, not before it, because a card face that renders a
value nothing can set is not demonstrable.

## Verification

- `pnpm typecheck && pnpm lint && pnpm test && pnpm test:e2e` all pass, exit codes
  read from redirected logs rather than from a pipeline's summary line, and the
  number that ran compared against the number collected.
- Deleting a card removes its comments; deleting a user does **not**, and leaves
  both their cards and their comments authorless — confirmed in `pg_constraint`
  and by a real delete, not only in `schema.ts`.
- A cold load of a card URL renders a page, and a click renders a modal, checked
  in a real browser and not only in Playwright.
- Browser-back from the modal leaves the board mounted, with its optimistic state
  intact — verified by making a change on the board, opening a card, and going
  back.
- A rejected comment rolls back and says so, forced.
- A `viewer` can comment and cannot edit any card field, and the field actions
  refuse a `viewer` when called directly.
- A due date set as *today* still reads as today in a browser set to UTC-8.
- Production is migrated by hand when Section 2 lands, before the code that needs
  the table merges.

## Open decisions carried forward

- **Comment length beyond 4,000 characters**, if sub-project 6's payload budget
  turns out to be tighter than expected.
- **Whether a card's column and board are shown on the canonical page.** It has
  the board's chrome from the layout but no canvas; whether it needs more context
  than a title is a design question for Section 3.

## Settled while brainstorming

- One spec with sections, not a split — the route pair and the comments table are
  both prerequisites for a modal that is not half-inert.
- **Comment editing and deletion: the author, and nobody else.** Not the board
  owner. This closes a `CLAUDE.md` open decision.
- **Due date threshold: today and tomorrow amber, before today rust.**
- **Title and description commit on blur**, with no Save button.
- **Approach A for the modal's data**: server-read at both entry points, writing
  through the board's reducer when one is mounted — rather than a client refetch
  or lifting board state into a new provider.
- **R2 for the routes**: the canonical page moves under the board so the
  intercept is the documented same-level case, and `CLAUDE.md` is corrected.
- `comments.authorId` sets null on user deletion, to keep a promise `/privacy`
  already makes.
- `cards.createdById` sets null too, once this sub-project's own
  `comments.cardId` cascade would otherwise turn that column's existing cascade
  into a way to delete other people's comments.
