# Spec: Activity log

Status: awaiting review, not implemented
Date: 2026-09-03
Sub-project: 11 — the first of the two open decisions carried by `CLAUDE.md`

## Goal

A member comes back to a board after a day away and asks one question: **what
happened here while I was gone?** The activity log answers it in a drawer over
the board, newest first, with a line marking where they last looked.

That framing was the first thing settled at the brainstorm and it decides most
of this spec. The log is a **catch-up feed**, not an audit trail and not a
per-card history. It is why entries are trimmed rather than kept, why the actor
is cascaded rather than nulled, why the drawer sits over the board instead of on
its own route, and why nothing streams.

## Non-goals

- **Not an audit trail.** Nothing here is immutable, complete, or retained. An
  owner asking "who deleted that column last March" is asking a question this
  feature deliberately cannot answer, and the answer is not to widen it — an
  audit trail wants different retention, different permissions and a different
  surface, and it would be its own sub-project.
- **Not a per-card history.** The card modal gains nothing. "Why is this card in
  Done" is a real question and it is not this one.
- **No realtime.** No twenty-second event. The board streams; the drawer does
  not, and the reasoning is in "Read on open" below.
- **No unread badge or count.** No number on the board header, none on
  `/boards`. The divider is the whole of the unread story.
- **No filtering, no search, no export, no "load more".**
- **No email address, ever.** See "Invites are absent on purpose".
- **No comment bodies and no descriptions.** An entry says what changed; the
  board says what it now says.

## Deliverables

### Schema: `activity` and `activity_reads`

```
activity        id, boardId, actorId, type, subjectId, subject, detail, createdAt
activity_reads  boardId, userId, lastSeenAt                    PK (boardId, userId)
```

Two migrations, because the two tables land in different sections: `0007`
carries `activity` in section A, `0008` carries `activity_reads` in section D.
Both are generated with `pnpm db:generate` and applied to production by hand in
the same sitting as the merge that carries them — `CLAUDE.md` "Commands" holds
the incident that makes that a rule.

Rules, and why each is what it is:

- **`activity.boardId` cascades from `boards`.** A feed is board vocabulary,
  gone when the board is — the same argument `labels.boardId` makes.
- **`activity.actorId` is `not null` and cascades from `users`.** This is the
  one place in this schema a user reference cascades, and it is a deliberate
  departure from `comments.authorId` and `attachments.uploaderId`, which set
  null so that `/privacy`'s promise holds: boards owned by other people keep
  what you contributed. An activity entry is not a contribution. It is a record
  *about* an action, it is trimmed at 500 regardless, and nothing another member
  wrote is lost when it goes. Cascading buys a simple true sentence in the
  policy — the record of what you did on a board is deleted with your account —
  in place of a feed full of "Someone renamed a card", which answers nobody's
  question in a feature whose whole job is saying who did what.
- **`subjectId` carries no foreign key, deliberately.** Half of all entries
  describe something that no longer exists; that is what "deleted the card 'Ship
  it'" *means*. A foreign key would either forbid the row or delete it at the
  moment it becomes interesting.
- **`subject` is the name as it was at the time**, capped at
  `ACTIVITY_SUBJECT_MAX`. Denormalised out of necessity rather than for speed:
  there is nothing left to join to.
- **`detail` is the second name an entry sometimes needs** — a move's
  destination column, a role change's new role, an attachment's filename. One
  nullable text column, not the `jsonb` this schema has so far never needed and
  does not need for two strings.
- **Index `activity(boardId, createdAt desc)`** — the feed's only read, and the
  trim's only scan.
- **`activity_reads` cascades on both sides**, from `boards` and from `users`,
  and holds nothing but `lastSeenAt`.

**`subject` is for things, never for people.** A `member.*` entry stores the
affected user's id in `subjectId` and leaves `subject` null; both the actor's
name and the subject's are resolved by join when the feed is read, and a subject
whose account is gone renders as "a member". Storing the name would retain
personal data past an erasure request through the back door — the outcome
rejected for actors, arriving as a subject instead. A test asserts the null
against the row itself, because this is a rule the next call site can break
without noticing.

### Caps: `lib/activity-limits.ts`

Imports nothing, for the same reason `lib/labels-limits.ts` and
`lib/attachments-limits.ts` import nothing.

- `ACTIVITY_PER_BOARD` (500) — the newest entries a board keeps. Also, exactly,
  the feed's depth: the window *is* the retention, which is why there is no
  "load more" to write.
- `ACTIVITY_SUBJECT_MAX` (120) — the stored name's cap.

Neither is a check constraint, matching the label and attachment caps.

### The write path: `recordActivity` in `lib/actions/scope.ts`

```ts
recordActivity(tx, { boardId, actorId, type, subjectId, subject, detail });
```

Called inside the transaction each action already opens, after `touchBoard`
where that applies. Twenty-five call sites: two in `boards.ts`, three in
`columns.ts`, six in `cards.ts`, three in `comments.ts`, four in `labels.ts`,
two in `attachments.ts` and five in `members.ts`. One of them — `moveCard` —
writes conditionally.

**It is not folded into `touchBoard`, though the two look alike.** `touchBoard`
is deliberately *not* called by every mutation: cards, columns, comments and
`setCardLabels` call it, while `boards.ts`, `members.ts`, `attachments.ts` and
label create/rename/delete do not, because those should not reorder `/boards` by
activity. Merging them would quietly change that ordering. They stay two calls,
and `recordActivity` is the last write in the transaction, extending the
ordering convention `lib/actions/*.test.ts` already asserts for `touchBoard`.

**Inside the transaction, not after it — the opposite of `publish`, for the
opposite reason.** An event announces something that already happened, so it
must wait for the commit; an entry *is* part of what happened. The cost is that
a failing entry rolls back the user's write. That is the right trade: a feed
whose only job is to be a record is worse than useless when it silently keeps a
partial one.

**The trim rides along.** Each insert is followed by a delete of that board's
rows beyond the newest `ACTIVITY_PER_BOARD`, over the same index the feed reads.
One extra indexed statement per mutation, deterministic — rather than trimming
every Nth write, which makes the table's size a function of luck. Vercel rules
out a scheduled job, so trimming on write is the only way this table is ever
bounded; the read-time window `board_invites` uses for expiry would leave the
busiest table in the app growing forever with rows nothing will ever read.

**A reorder writes nothing.** The rule for what earns an entry is one sentence:
*if it only changed an order, it is not news.* `moveColumn` therefore writes
none at all, and `moveCard` writes one only when the column changed. `moveCard`
does not currently read the card's old `columnId` — it will, inside the
transaction it already has.

### The vocabulary: `lib/activity.ts`

Twenty-six types, a closed union written the way `BoardEvent` is written. The
renderer switches exhaustively over it, so **adding a type without giving it a
sentence fails `pnpm typecheck`** — the guarantee `EveryEventIsBound` gives the
event set, by the same trick.

| Group | Types |
|---|---|
| Board | `board.created`, `board.renamed` |
| Column | `column.created`, `column.renamed`, `column.deleted` |
| Card | `card.created`, `card.renamed`, `card.described`, `card.due_set`, `card.due_cleared`, `card.moved`, `card.deleted` |
| Comment | `comment.added`, `comment.edited`, `comment.deleted` |
| Label | `label.created`, `label.renamed`, `label.deleted`, `card.labelled` |
| Attachment | `attachment.added`, `attachment.removed` |
| Member | `member.joined`, `member.left`, `member.removed`, `member.role_changed`, `member.ownership_transferred` |

Four decisions inside that table:

- **Invites are absent on purpose.** `inviteMember`, `revokeInvite` and
  `declineInvite` write nothing. An invite carries an email address, and
  `CLAUDE.md` is explicit that only the owner ever sees a pending one; a
  board-wide feed is the one place that address must not appear. `member.joined`
  covers the part every member may see.
- **`attachment.added` is written by `confirmUpload`, never `requestUpload`.** A
  pending row may describe bytes that never landed, and the feed must not
  announce a file that does not exist.
- **`deleteBoard` writes nothing.** The feed cascades with the board it
  describes.
- **`deleteAccount` writes nothing.** The cascade removes the departing member's
  entries, which is the whole of its activity behaviour.

Two places where one act must not become several entries:

- **`createBoard` writes `board.created` and nothing else.** It seeds five
  columns; those seeds write no `column.created`, or every board would open with
  six entries describing its own birth.
- **`deleteColumn` writes one `column.deleted`**, carrying the target column in
  `detail`. The cards it moves write no `card.moved` of their own — the reader
  is told the column went and where its cards landed, which is the whole of what
  happened.

Sentences follow `CLAUDE.md`'s copy rules — active voice, sentence case, no
filler: "Vit moved Ship the drawer to In Review". Entries name what changed and
never the new content.

### Reads

One server-side read, `boardActivity(boardId, userId)`, joining `users` for the
actor and for a `member.*` subject, ordered `createdAt desc`, limited to
`ACTIVITY_PER_BOARD`. It goes through `assertBoardAccess` like everything else,
and it returns entries already rendered to sentences, so no client component
ever receives a role — `lib/permissions.ts` pulls the driver into any bundle
that imports it.

### The surface: a drawer over the board

`components/ui/sheet.tsx` — shadcn's Sheet, which is the Radix Dialog already
behind `components/ui/dialog.tsx`, so this is a new file and no new dependency.
Re-tokenised the way `dialog.tsx` was; untouched shadcn is instantly
recognisable.

Opened from the board header beside the existing controls, a right-side
slide-over at full viewport height on `--surface` over a 1px `--line`, closing
on Escape with focus returning to its trigger. Full width below 700px, where the
board is already one column at a time. Rows group by day — "Today",
"Yesterday", then a date — each showing the actor's avatar in its existing
cool-hue hash, the sentence, and a relative timestamp in Roboto Mono, the "data"
role from the type scale. Skeleton rows while it loads, never a spinner.
"Nothing here yet" on a new board.

Two details decide whether it works:

- **The divider reads `lastSeenAt` before it writes it.** Opening the drawer
  both answers "where was I" and updates the answer; done in the wrong order the
  line is always at the top and the feature is a no-op. Read, render, then
  upsert. The line stays put while the drawer is open, which costs nothing
  because nothing streams.
- **The divider is `--line` and `--muted`, never amber.** "New since your last
  visit" is exactly where a hand reaches for a warning colour. Warm is never at
  rest on the board, and the drawer adds no fourth colour role: the only colour
  in it is the actor's avatar.

### Read on open

The drawer fetches when opened and does not change while you read it. No
twenty-second event, no change to `EVENT_NAMES` or to `EveryEventIsBound`, and
no extra Pusher traffic — `CLAUDE.md` already names the free tier as the thing
that would force a move to Ably, and doubling every mutation's message volume to
keep a rarely-open drawer warm is the wrong place to spend it. Rendering a live
tail from the twenty-one events the client already receives was considered and
rejected: it would write every sentence twice, once on the server for stored
entries and once on the client for live ones, and the two would drift the first
time anybody edited the wording.

## Permissions

- Reading needs `viewer`. Seeing the board is seeing what happened on it — the
  same argument attachments make.
- Writing is not a permission at all: an entry is written by the action that
  already checked one. There is no action that creates an activity entry.
- No entry is editable or deletable by anyone. The trim is the only delete.

## Privacy

`/privacy` gains two sentences, both of which the code must actually honour:

- The "what you create" list gains the record of what changed on a board and who
  changed it.
- The deletion section gains that this record is deleted with the account.

`app/(legal)/privacy/page.test.tsx` already pins the policy to behaviour for the
hosting region; the deletion claim gets the same treatment, because this is
exactly the sort of promise that drifts.

## Testing

Per-action unit tests extend what exists: each mutation writes exactly one entry
with the right type and subject, ordered last in its transaction the way
`touchBoard` already is. Beyond that, five that earn their place:

- **The reorder exclusion** — a within-column `moveCard` writes none, a
  cross-column one writes exactly one. The single most likely thing to regress,
  and the only one a reader would never notice going wrong.
- **The trim** — 501 inserts leave 500 rows, and the one missing is the oldest.
- **The cascades** — deleting a user removes their entries; deleting a board
  removes its feed.
- **The subject rule** — a `member.*` row stores a null `subject`, asserted
  against the row itself, so the erasure promise is enforced by a test rather
  than by whoever writes the next call site.
- **The divider** — a component test (jsdom, with this repo's hand-wired
  `afterEach(cleanup)`) proving the line sits above the unseen entries on first
  open and not at the top on the second.

An e2e closes it: two members, one acts, the other opens the drawer and sees
both the entry and the divider above it.

## Sections and pull requests

One section, one branch, one PR, in this order:

- **A — the table and the seam.** The `activity` table, migration `0007`,
  `lib/activity-limits.ts`, `lib/activity.ts`, `recordActivity` with its trim,
  and the card and column call sites including the reorder exclusion. No UI.
  Branch `feat/activity-write`.
- **B — the remaining call sites.** Comments, labels, attachments, members and
  boards, each with its test, and the member subject rule.
  Branch `feat/activity-actions`.
- **C — the drawer.** `components/ui/sheet.tsx`, the header trigger,
  `boardActivity`, grouping, skeletons, empty state, responsive behaviour.
  Branch `feat/activity-drawer`.
- **D — the divider and the policy.** `activity_reads` and migration `0008`, the
  read-then-upsert, the line, the `/privacy` changes with their test, and the
  two-client e2e. Branch `feat/activity-divider`.

B depends on A, C on B, D on C. Branch each from `main` once its parent has
landed rather than stacking — `CLAUDE.md` records two stacks that stranded a
child PR on a consumed base.

Section A carries a migration, and so does D. Apply each to production by hand
in the same sitting as its merge, and read the table list back.

## Verification

Ticked only against observed output, per section:

- [ ] `pnpm typecheck && pnpm lint && pnpm test && pnpm build` all pass, each
      exit code read directly rather than through a pipe.
- [ ] `pnpm test:e2e` passes, with the number that ran compared against the
      number collected.
- [ ] Each section's migration (`0007` in A, `0008` in D) applied to
      production in the same sitting as its merge, confirmed by reading
      `information_schema.tables` back and by the applied count in
      `drizzle.__drizzle_migrations` equalling the file count in
      `lib/db/migrations/`.
- [ ] A within-column drag writes no entry, observed against the real table
      rather than inferred from the test.
- [ ] The drawer opens, reads and closes on a deployed preview at 360px as well
      as at desktop width.
- [ ] The divider sits above the unseen entries on a second browser, and moves
      on the next open.
- [ ] Deleting an account removes that member's entries from a board owned by
      somebody else, observed in the database.

## Documentation changed in the same pull requests

- `CLAUDE.md`: the data model gains `activity` and `activity_reads` with the
  cascade argument; "Open decisions" loses the activity log and says where the
  spec is; the layout tree gains `lib/activity.ts`, `lib/activity-limits.ts` and
  the drawer component.
- `app/(legal)/privacy/page.tsx`, in Section D, with its test.

## Settled while brainstorming

- **A catch-up feed, not the other three.** Per-card history, an owner's audit
  trail and a single log serving all three were all on the table. Choosing
  catch-up is what makes trimming acceptable, cascading correct, and streaming
  unnecessary — the other purposes disagree with all three.
- **Everything but pure reorders.** A curated shortlist was considered and
  rejected: it loses "somebody moved my due date", which is precisely what a
  returning member is looking for. Logging every mutation was rejected too — one
  drag session would bury the reader's actual question under rank changes.
- **A drawer, not a route and not an intercepting route.** The feed is a lens on
  the board, not a destination; the reader's next move is always to look at the
  card an entry names. The intercepting parallel route would buy a shareable URL
  for a feed nobody links to, at the cost of a second `@slot` and its
  `default.tsx`.
- **Derived entries were rejected on three counts.** Writing entries inside
  `publish()` would cover all thirty actions from one place and cannot work:
  `publish` runs after the commit by design, so the entry would land outside the
  write it describes; delete events carry only an id, so "deleted the card 'Ship
  it'" is unrenderable by then; and the mapping is not one-to-one, since
  `inviteMember` publishes nothing and `transferOwnership` publishes twice.
- **Postgres triggers were rejected** for being unable to name the actor: the
  database has no session, and threading the user id down per statement is more
  machinery than the twenty-five call sites it would save.
- **The name-retaining variant was rejected on the record.** Storing the actor's
  display name on the entry would keep the feed intact after an account is
  deleted, by retaining personal data past an erasure request. It is written
  down here so it stays rejected rather than being reinvented as an
  optimisation.

## Open decisions carried forward

- **Board archive vs hard delete** — untouched by this spec, and the last of the
  two `CLAUDE.md` carries. Nothing here forecloses it: an archived board would
  keep its feed the way it keeps its cards.
