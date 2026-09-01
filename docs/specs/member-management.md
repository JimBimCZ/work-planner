# Spec: Member management and invites

Status: approved, not implemented
Date: 2026-09-01
Sub-project: 7 of 10 — built after 8, per `docs/specs/account-deletion.md` "Order"

## Goal

A board gets a second person on it, through the app rather than through a
hand-seeded row. The owner invites by email address, the invitee accepts or
declines, roles can be changed, people can be removed and can leave, and a
board can change hands.

The role ladder has existed since sub-project 3 and every server action written
since calls it, but `member` and `viewer` have never been reachable — the only
`board_members` row anything writes is the owner row `createBoard` inserts.
This is the sub-project that makes the ladder mean something, and it brings
ownership transfer with it, which is what `/account`'s delete has been blocked
on since sub-project 8.

## Non-goals

**No email delivery.** The app sends none, has no provider and no sender
domain — settled in `docs/specs/account-deletion.md` and unchanged. An invite is
therefore discovered in the app, on `/boards`, and nowhere else. Whoever invites
you has to tell you they did, through whatever channel they already use.

**No invite links.** A tokenised URL would remove the dependency on the
invitee's account email matching the address typed, but it needs a token with
expiry and revocation of its own, and a leaked link is an open door with no
addressee to check it against.

**No presence.** Who is *currently looking* at the board stays what
`CLAUDE.md` already calls it — a later addition. This sub-project answers who is
*on* the board.

**No activity log.** Invites leave no history: accept, decline, revoke and
expiry all delete the row. An audit trail here would be the first half of a
feature `CLAUDE.md` still lists under "Open decisions".

**No second owner.** A board has exactly one, and ownership moves only through
`transferOwnership`. Co-owners would make every "owner or not" check in the
codebase a set membership question instead of a comparison.

**No bulk invite**, no CSV, no invite-many-at-once. One address at a time.

## Deliverables

### Schema: `board_invites`

```ts
export const boardInvites = pgTable(
  'board_invites',
  {
    id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
    boardId: text('board_id').notNull().references(() => boards.id, { onDelete: 'cascade' }),
    email: text('email').notNull(),
    role: boardRole('role').notNull(),
    invitedById: text('invited_by_id').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('board_invites_board_id_email_key').on(t.boardId, t.email),
    index('board_invites_email_idx').on(t.email),
    check('board_invites_role_not_owner', sql`role <> 'owner'`),
  ],
);
```

`unique()` and `check()` are both table-level builders in drizzle-orm 0.45.2 —
verified in `node_modules/drizzle-orm/pg-core/`, not assumed.

- **`email` is stored trimmed and lowercased**, and matched against
  `session.user.email` lowercased. `users.email` is unique and comes from the
  OAuth provider; nothing guarantees its case.
- **The check constraint carries the one-owner invariant into the database**,
  the way `cards.columnId`'s `NO ACTION` carries "never orphan a card". An
  invite can never mint a second owner even if a bug hands Zod the wrong string.
- **`invitedById` sets null**, matching `comments.authorId`. It exists so the
  invitee reads "Alex invited you to Roadmap" rather than a board name with no
  provenance; the copy falls back to the board alone when it is null.
- No `status` column. A row exists only while the invite is pending.

### The invite lifecycle

**`inviteMember` upserts on `(boardId, email)`.** This is load-bearing, not a
convenience. Expiry is filtered at read time rather than purged, so an expired
row is invisible to both sides while still occupying the unique key — a plain
insert would make re-inviting a lapsed address fail with a conflict on a row
nobody can see. The upsert renews `createdAt` and lets the owner correct a
pending invite's role in the same motion.

**Expiry is `INVITE_TTL_DAYS = 30`**, applied in every query that lists or
resolves an invite: the invitee's list, the owner's pending list, and
`acceptInvite`'s own re-check. No purge job — Deployment forbids one, and a
lazily filtered row costs a date comparison on a table with an index on the
column being looked up.

**`deleteAccount` gains one statement**: delete `board_invites` where `email`
matches the departing user's address. There is no foreign key to cascade
through — invites key on an address, not a user id — so without it a pending
invite keeps an email address alive after the account it belongs to is gone.
That is a hole in what `/privacy` promises today, and closing it costs one line.

### `lib/members.ts` — reads

Mirrors `lib/boards.ts` and `lib/account.ts`: plain functions, no `'use server'`,
called from server components and from the actions.

```ts
listMembers(boardId): Promise<{ userId, name, email, image, role }[]>
listPendingInvites(boardId): Promise<{ id, email, role, createdAt }[]>
listInvitesForUser(email): Promise<{ id, boardName, role, invitedByName }[]>
```

`listPendingInvites` and `listInvitesForUser` both apply the TTL, and
`INVITE_TTL_DAYS` lives here beside them. Callers do the permission check; these
functions answer questions, they do not authorise — same division as
`getBoardWithColumns`.

**`listMembers` returns emails, and the server strips them before they reach a
non-owner's browser.** "Only the owner sees email addresses" is a rule about
what is *sent*, not about what is rendered: a dialog that receives every
address and hides some of them has already published them to the client bundle
and the network tab. The server component that opens the dialog drops the field
unless the viewer is the owner, so a non-owner's props never carry one.

### `lib/actions/members.ts`

| Action | Who | Errors beyond `UNAUTHENTICATED` / `INVALID` / `NOT_FOUND` / `FORBIDDEN` |
|---|---|---|
| `inviteMember({ boardId, email, role })` | owner | `ALREADY_MEMBER` |
| `revokeInvite({ inviteId })` | owner of that invite's board | — |
| `acceptInvite({ inviteId })` | the addressee | — |
| `declineInvite({ inviteId })` | the addressee | — |
| `changeRole({ boardId, userId, role })` | owner | `TARGET_IS_OWNER` |
| `removeMember({ boardId, userId })` | owner | `TARGET_IS_OWNER` |
| `leaveBoard({ boardId })` | any non-owner member | `OWNER_CANNOT_LEAVE` |
| `transferOwnership({ boardId, userId, confirmName })` | owner | `NOT_A_MEMBER`, `NAME_MISMATCH` |

Every one follows the convention block: session, Zod, `assertBoardAccess`,
transaction, publish after commit, discriminated result, no throwing for
expected failures. `role` parses as `z.enum(['member', 'viewer'])` — never the
full `boardRole` enum, so `owner` is rejected before it reaches the constraint
that would also reject it. `email` parses with `z.email()`, which is Zod 4's
top-level validator; `z.string().email()` is deprecated in the installed 4.5.4.

Four that are not mechanical:

- **`acceptInvite` and `declineInvite` do not call `assertBoardAccess`.** The
  invitee is by definition not on the board yet. They are scoped by the
  session's own email matched against the invite row, the way `deleteAccount` is
  scoped by the session's own user id. This is the only place in the codebase
  where a board is touched without a membership check, and the file says so.
- **`acceptInvite` answers `NOT_FOUND` for every failure** — no such invite,
  expired, revoked, or addressed to somebody else. One answer, so a guessed id
  learns nothing, exactly as `assertBoardAccess` refuses to distinguish a
  missing board from one you are not on.
- **`acceptInvite` on someone who is already a member** deletes the invite and
  returns `ok`. The end state the user asked for is the end state they get.
- **`transferOwnership` is one transaction**: `boards.ownerId` to the target,
  the target's `board_members.role` to `owner`, the caller's to `member`.
  Confirmation is typing the board name, matching `deleteBoard`. The target must
  already hold a `board_members` row, so a board can only be handed to someone
  who has accepted being on it.

### The members dialog

A control in the board header beside "New card", opening the existing `Dialog`
primitive. Everyone on the board can open it; what is inside depends on role.

The board layout passes it to `TopBar` unconditionally. `NewCardButton` is
today's only `actions` child and it is gated on `atLeast(role, 'member')`, so
the obvious edit — adding the members control inside that same conditional —
would hide it from exactly the people most likely to want out of a board.

- **Everyone sees** the member list — avatar via the existing `avatarHue` and
  `initials` helpers, name, role — and, if they are not the owner, "Leave board".
- **Only the owner sees email addresses**, the invite field, and the pending
  list. Names identify a colleague on a board you already share; addresses are
  contact details handed to one person, not to the board. `/privacy` says board
  *content* is visible to members, and it should keep meaning only that.
- **Owner controls**: an email field with a role select, a role select and
  "Remove" per member row, "Make owner" per member, "Revoke" per pending invite.
  Transfer is a second step inside the dialog that asks for the board name typed
  out.
- The owner is never offered "Leave board". The copy says to transfer the board
  first, rather than presenting a control that returns `OWNER_CANNOT_LEAVE`.

Warm colour appears only on "Remove", "Leave board" and the transfer
confirmation — destructive, transient, inside a dialog the user opened
deliberately. Nothing warm comes to rest on the board.

### Invitations on `/boards`

Above the board list: "Alex invited you to Roadmap as a member", with "Accept"
and "Decline". If the user has invitations but no boards, the invitations render
above the existing "Create your first board" empty state rather than replacing
it — one is a thing to do, the other is a thing waiting for you, and they are
not alternatives.

`/boards` is dynamic per session, so a removed or newly added member sees the
right list on their next load regardless of revalidation.

### Realtime: three events

Added to `BoardEvent` in `lib/events.ts` **and** to `EVENT_NAMES` in
`components/board/realtime.tsx` in the same pull request — `CLAUDE.md`'s own
warning is that the second list is where an event goes to be silently
undelivered.

```ts
| { type: 'member.added'; userId: string; role: BoardRole }
| { type: 'member.updated'; userId: string; role: BoardRole }
| { type: 'member.removed'; userId: string }
```

The payloads carry an id and a role and nothing else. An earlier draft had
`member.added` carrying the new member's name and image; nothing consumes them.
The dialog refetches when it is open, and the realtime ring derives its colour
from `avatarHue(userId)`, which needs only the id.

`acceptInvite` publishes `member.added`; `changeRole` publishes
`member.updated`; `removeMember` and `leaveBoard` publish `member.removed`;
`transferOwnership` publishes two `member.updated`. That makes fifteen events,
not twelve. Invite and revoke publish nothing: only the owner can see pending
invites, and the owner is the only person who can create or withdraw one.

Client handling sits in a small subscriber mounted by the board layout, inside
`RealtimeProvider`. When an event names *you*: `member.removed` replaces the
route with `/boards`; `member.updated` calls `router.refresh()`, so the server
recomputes `canWrite` from the role it just read and the board stops offering
writes that would be rejected. Events naming somebody else are ignored unless
the members dialog is open, in which case it refetches.

Two consequences worth stating before they are discovered:

- **Your own action never reaches you as an event.** The provider drops echoes
  whose `mutationId` you claimed, so `leaveBoard` does not redirect you via
  Pusher — the component navigates when the action resolves. The event exists
  for everyone else.
- **The server cannot force a removed client to unsubscribe.** What it can do is
  refuse the next authorisation: `/api/pusher/auth` re-checks membership on every
  subscribe, so a reload or a reconnect after a dropped socket is refused and
  the status strip goes to `failed`. The honest bound is "until they navigate
  away or their socket drops", and redirecting them on `member.removed` makes
  that the same instant in practice.

### What this closes in `/account`

Nothing in `lib/actions/account.ts` changes except the invite cleanup above.
After a transfer the departing user is a `member`, not the owner, so
`sharedBoardsOwnedBy` no longer returns the board and the danger zone unblocks
itself. The blocked list's copy gains a second way out — transfer the board from
its members dialog — alongside deleting it.

## Testing

**`lib/actions/members.test.ts`**, against a real database as
`account.test.ts` is, covering every error row in the action table plus the
three things that are invariants rather than behaviours:

- the check constraint refuses `role = 'owner'` on a direct insert;
- an expired invite is invisible to both lists *and* re-invitable, proving the
  upsert rather than the filter;
- `transferOwnership` leaves exactly one `owner` row and a `boards.ownerId` that
  agrees with it.

**`e2e/members.spec.ts`** grows across the sections rather than landing whole.
Section B drives the owner's dialog against a seeded second member — the way the
card-modal suite already seeds one. Section C replaces the seed with the real
invite → accept flow, making this the first test in the repository that creates
a second `board_members` row through the UI. Section D adds the assertions that
need two live clients: a demotion that removes the write controls without a
reload, and a removal that lands the removed user on `/boards`.

**`app/(legal)/privacy/page.test.tsx`** gains an assertion for the invited-address
disclosure, alongside the region assertion it already makes.

## Sections and pull requests

| | Contents | Base |
|---|---|---|
| **A** | Schema, migration, `lib/members.ts`, `lib/actions/members.ts`, unit tests. No UI, no events. | `main` |
| **B** | Members dialog and the board-header control; owner management and "Leave board". | `main` after A |
| **C** | Invitations on `/boards`, accept and decline, the `deleteAccount` invite cleanup, `/privacy`. | `main` after A |
| **D** | The three events end to end — publish, `EVENT_NAMES`, self-removal and self-demotion. | `main` after B and C |

B and C are independent of each other and both need A. Each branches from `main`
once its parent has landed rather than stacking, and the base is confirmed with
`git merge-base --is-ancestor <parent-tip> origin/main` before the section
starts — `CLAUDE.md` records two stranded stacks already.

Section A's migration is applied to production by hand by whoever merges it,
per Deployment.

## Verification

- `pnpm typecheck && pnpm lint && pnpm test && pnpm build && pnpm test:e2e`, each
  exit code read from its own redirected log, count run compared against count
  collected.
- `pnpm build` specifically: `lib/permissions.ts` and `lib/events.ts` are both
  server-only, and the members dialog is a client component that must not import
  a value from either. Typecheck, lint and test all pass on that mistake; only
  bundling catches it.
- Two real accounts in two browsers: invite, accept, and the second user opens
  the board; a card moved by one appears for the other; demotion to viewer
  removes the write controls without a reload; removal lands the removed user on
  `/boards` with the board gone from the list.
- The database is read directly after a transfer — one `owner` row,
  `boards.ownerId` matching — rather than inferred from the UI.
- A pending invite to an address is gone from `board_invites` after that account
  is deleted.
- Screenshots of the members dialog and the `/boards` invitations, both themes,
  at 1440px and 390px.

## Documentation changed in the same pull requests

- `CLAUDE.md`, "Auth and permissions": the invite-flow line is rewritten. There
  is no sign-in callback — invites are keyed on email and resolved when the
  invitee accepts from `/boards`, which is why nothing reaches into Auth.js.
- `CLAUDE.md`, "Data model": `board_invites`, and the index list.
- `CLAUDE.md`, "Realtime": twelve events becomes fifteen.
- `CLAUDE.md`, "Open decisions": member management resolved; the account-deletion
  entry's "there is no ownership transfer until member management lands" is
  replaced by what exists.
- `/privacy`: the address you type to invite someone is stored until the invite
  is accepted, declined, revoked or expires, and is deleted with your account.
  `LAST_UPDATED` moves with it.

## Settled while brainstorming

- **Pending invite with an explicit accept**, over adding an existing user
  straight to `board_members`. With no email delivery the invite has to be
  discovered in the app either way, and an accept step is what stops "a stranger
  put a board in your list" from being a thing that simply happens to you. It
  also gives one code path for both cases and needs no hook inside Auth.js
  sign-in — which is what `CLAUDE.md` described before this spec.
- **Owner only manages members**, handing out `member` or `viewer`. Rejected:
  members inviting members, which makes anyone trusted with cards also able to
  widen who sees the board.
- **Transfer is immediate, and the old owner stays a `member`.** Rejected:
  transfer that also removes the outgoing owner, which conflates two actions;
  and a transfer offer the recipient accepts, which is a second pending-state
  workflow and would block an account deletion on somebody else's attention.
  This answers the question `docs/specs/boards.md` left open under "Whether a
  board can change owner". It is narrower than the auto-transfer
  `docs/specs/account-deletion.md` rejected: the target already accepted being
  on the board, and ownership adds powers rather than obligations.
- **A dialog from the board header**, over a `/boards/[boardId]/members` page —
  which would mean a second route tree under `boards/[boardId]` alongside the
  `(board)` group and its `@card` intercept — and over the board list's row
  menu, from which you cannot fix membership while looking at the board.
- **Three membership events**, over publishing only `member.removed` or nothing.
  A demoted viewer that still renders write controls is a UI that lies, and
  without any event a removed user keeps receiving live board content until they
  close the tab.
- **Leave, revoke and a 30-day expiry all ship.** Revocation is close to a
  correctness requirement: a typo'd address otherwise waits in the table to hand
  board access to whoever eventually signs up with it.
- **Emails are visible to the owner only**, not to the whole member list.

## Open decisions carried forward

- **Who can see a member's email** if roles ever grow past three. The rule here
  is "the owner, because they typed it"; a board admin role would need a
  deliberate answer rather than an inherited one.
- **What happens to an invite when the invitee's provider email changes.** The
  address is matched at accept time, so an invite to an old address is simply
  never resolvable and expires. Nothing reconciles them.
