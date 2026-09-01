# Spec: Account deletion

Status: approved, not implemented
Date: 2026-09-01
Sub-project: 8 of 10 — see "Order" below

## Goal

A signed-in user can delete their own account from inside the app, and the
deletion is real: their identity, their sessions, their OAuth links, their
memberships and the boards they own all go, in one transaction, immediately.

`/privacy` has promised deletion since it was written and pointed at a mailbox
to do it. This makes the promise self-service, and stops the policy describing
a mechanism that only exists in a human's inbox.

## Non-goals

**No ownership transfer.** A board you own that has other members blocks the
delete; the only resolution offered is deleting that board. Transfer needs
member management, which is sub-project 7 and is being built next — it can add
transfer to this dialog when it lands.

**No member management.** Nothing here writes `board_members`. The only write
in the codebase today is the owner row `createBoard` inserts.

**No deletion of comments on other people's boards.** `comments.authorId` sets
null, so they survive without a name on them. Asking for them to be removed as
well stays an email request, exactly as `/privacy` already describes.

**No grace period, no soft delete.** `CLAUDE.md` says cards and comments are
"soft-delete free: hard delete", and a recoverable account would need a
`deletedAt` on `user`, that filter on every query that touches it, and a
scheduled purge — the closest thing to the per-process job queue Deployment
forbids.

**No data export.** GDPR portability is answered by the contact address in the
policy today. `/account` is where an export button would go if it ever gets a
UI; this spec does not build one.

**No email.** The app sends none, has no provider and no sender domain, and a
confirmation link would add a sub-processor to protect a flow that already
demands an exact typed string.

## Deliverables

### `/account`

`app/(app)/(chrome)/account/page.tsx`, a server component. It shows who you are
signed in as — name, email, avatar, and which provider the `account` row names —
and a danger zone beneath it.

It sits under `(chrome)`, so `TopBar` and `SiteFooter` come from the existing
layout and no new route group is introduced. `CLAUDE.md` warns that a new
top-level group has no footer until it is given one; this avoids the question
rather than answering it. `/account` is added to the route list in
`e2e/board-view.spec.ts` that names every path required to keep the footer.

The account menu gains an "Account" item above "Privacy".

### The danger zone

The only warm thing on the page. `--time-over` on the delete control is the
destructive use the colour rule permits — transient, local, inside a dialog the
user opened deliberately, never at rest on a board.

It states, before anything is typed:

- The boards you own are deleted, with every column, card and comment on them.
- Your comments on other people's boards stay, without your name attached.
- **If you want those removed too, ask before you delete.** Afterwards
  `authorId` is null and nothing links them to you, so the request cannot be
  honoured. This sentence is the reason the section exists — it is the one
  irreversible consequence a user cannot discover afterwards.
- It cannot be undone.

Confirmation is typing your own email address, matching the typed-name
confirmation `deleteBoard` already uses. The control says "Delete account".

### The blocking rule

The page queries boards where `boards.ownerId` is you and a second
`board_members` row exists. If the list is non-empty the danger zone renders it
— each board named and linked — and offers no delete control at all.

`deleteAccount` re-checks the same condition inside its transaction and returns
`OWNS_SHARED_BOARDS` with the offending board names. A client can skip the page,
and a member could in principle be added between the render and the submit.

The list is empty for every user today, because nothing writes a second member.
The guard is written now because the day invites ship, its absence becomes
silent destruction of other people's boards rather than a design decision.

### `lib/actions/account.ts`

One export, following the house shape exactly: session first, Zod second,
discriminated result, no throwing for expected failures.

```ts
deleteAccount({ confirmEmail: string })
  -> { ok: true }
   | { ok: false, error: 'UNAUTHENTICATED' | 'INVALID' | 'EMAIL_MISMATCH' }
   | { ok: false, error: 'OWNS_SHARED_BOARDS', boards: { id: string; name: string }[] }
```

No `assertBoardAccess`. The action is self-scoped: the only id it acts on is the
session's own `user.id`, which is never taken from the client.

The delete is one statement, because the schema already encodes every rule:

| Rows | What happens | Why |
|---|---|---|
| `account`, `session` | cascade from `user` | Auth.js adapter tables, `onDelete: 'cascade'` |
| `board_members` | cascade from `user` | your memberships elsewhere disappear |
| `boards` you own | cascade from `user` | and with them their columns, cards and comments |
| `comments.authorId` | set null | `/privacy`: other people's boards keep your comments |
| `cards.createdById` | set null | a cascade here would delete other people's comments on a card you happened to create |

One cascade in that chain has never been exercised and must be proved rather
than reasoned about. `cards.columnId` references `columns` with `ON DELETE no
action`, and deleting a user now cascades to `boards`, which cascades to
`columns` and `cards` in the same statement. `NO ACTION` is checked at the end
of the statement rather than immediately, so the constraint should be satisfied
by the time it is looked at — but the only deletion ever proved against real
data was a board delete, and that was proved before cards existed. The plan
tests a user delete against a board holding columns, cards and comments.

Then `signOut({ redirectTo: '/signin' })`.

`revalidatePath('/boards')` for the board list. No Pusher event is published: by
construction every board being deleted has exactly one member, so there is no
second client subscribed to tell.

### Sign-out after the row is gone

Auth.js is asked to sign out a session whose row the cascade has already
deleted. The expected behaviour is a delete matching zero rows and a cleared
cookie, but that is an expectation about a library and must be proved, not
assumed.

The failure mode is benign either way: a cookie left pointing at a session that
no longer resolves means `auth()` returns null and the `(chrome)` layout
redirects to `/signin`. `proxy.ts` checks only that a cookie is present, so it
would not be what catches it — the layout is.

## Testing

**`lib/actions/account.test.ts`** — unauthenticated; invalid input; a
mismatched email; blocked when the user owns a board with a second member; and
the happy path, which asserts the cascade actually happened rather than trusting
the foreign keys: `account`, `session` and `board_members` rows gone, owned
boards gone, and a comment left on someone else's board still present with
`authorId` null.

**`e2e/account.spec.ts`** — the page renders for a signed-in user; a wrong email
is refused and says so; deleting signs the user out to `/signin` and the old
session cookie no longer opens `/boards`. The blocked case is seeded with a
second `board_members` row directly, as the card-modal suite already seeds
members it has no UI to create.

**`e2e/board-view.spec.ts`** — `/account` added to the footer route list.

## Sections and pull requests

One section, one PR. The work does not decompose usefully: the action without
the page is untestable end to end, and the page without the action is a form
that does nothing.

## Verification

- `pnpm typecheck && pnpm lint && pnpm test && pnpm build && pnpm test:e2e`,
  each exit code read from its own redirected log, count run compared against
  count collected.
- A real account, deleted in a browser, is gone from the database — confirmed
  with a `select` against `user`, `account`, `session` and `board_members`, not
  inferred from the redirect.
- A comment that account left on another user's board is still readable by that
  user afterwards, with no name on it.
- The old session cookie does not open `/boards` after deletion.
- A user owning a board with columns, cards and comments deletes without the
  `cards.columnId` `NO ACTION` constraint firing.
- Screenshots of `/account` and the danger zone in both themes, at 1440px and
  390px.

## Documentation changed in the same PR

- `/privacy`, "Keeping and deleting your data": "there is no self-service
  delete yet" is replaced by what the flow does, keeping the email route for
  comments on other people's boards. `LAST_UPDATED` moves with it.
- `CLAUDE.md`, "Open decisions": the account-deletion entry is resolved, and the
  remaining order is recorded — see below.

## Order

The original roadmap had seven sub-projects, the seventh being the invite flow
and member management. Three more were added on 2026-09-01: account deletion,
labels/tags, and attachments. They are built in this order:

1. **8 — account deletion** (this spec)
2. **7 — member management and invites**, which brings ownership transfer with it
3. **9 — labels/tags**
4. **10 — attachments**

Attachments carry an unresolved conflict to settle at its own brainstorm, not
here: a blob store cannot run against the Postgres in `docker-compose.yml`, and
that is the same objection that disqualified Neon Auth. It is also a new
sub-processor for `/privacy`, and a 5MB file cannot travel through a server
action, so the upload must go client-direct with a signed token.

## Settled while brainstorming

**Blocking beats cascading.** Deleting a user cascades `boards.ownerId` today,
so a self-service delete without a guard would destroy boards other people work
on. Rejected: auto-transfer to the longest-standing member, which hands someone
a board without asking.

**Comments elsewhere are kept, and the email route stays.** Rejected: a
checkbox to delete them, and always deleting them. The consequence accepted with
this choice is that a self-service delete makes the policy's "unless you ask for
those too" unreachable afterwards, which is why the danger zone has to say so
before the fact.

**Immediate and irreversible.** Rejected: a 30-day grace period, and an emailed
confirmation link.

**A page, not a dropdown dialog.** The flow can be multi-step — a blocked list
sends you to `/boards` and back — and a dead end anchored to a dropdown is a
poor place for that.
