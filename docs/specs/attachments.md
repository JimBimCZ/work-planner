# Spec: Attachments

Status: approved, not implemented
Date: 2026-09-02
Sub-project: 10 of 10 — see `docs/specs/account-deletion.md` "Order"

## Goal

A card carries the files the work is about. A member attaches a screenshot of
the bug, the PDF of the spec, the log that shows the stack trace, and everyone
on the board can see it without leaving the card.

An attachment is **card content, not speech.** That ordering was settled first
and it decides most of this spec: it is why a viewer cannot attach although a
viewer can comment, why the board owner can delete a file although the board
owner cannot delete a comment, and why the bytes are billed to somebody and so
have caps a comment does not need.

## Non-goals

**No image processing.** No thumbnails, no resizing, no EXIF stripping, no
format conversion. An image renders inline at a constrained height from the
original bytes. A thumbnail pipeline is a background job, and `CLAUDE.md`
forbids those on Vercel: "no module-level caches, no per-process job queues".

**No versioning.** Attaching a file with a name that already exists on the card
produces a second attachment, not a new version of the first. There is no
history, no restore, no diff.

**No previews for non-images.** A PDF is a download, not an embedded viewer.
Embedding a PDF means shipping a renderer or trusting an iframe with user bytes,
and neither is worth it for the second-most-common file type.

**No multipart upload, no resumable upload.** A 10 MB cap is chosen partly so
that one `PUT` is always enough. Raising the cap later is not a config change —
it is this decision reopened.

**No paste-to-attach.** Dropping a file and picking a file are the two ways in.
Paste is a plausible third and deliberately deferred; it changes the clipboard
handling on a modal that already handles a description textarea, and nothing in
the goal needs it.

**No copying an attachment between cards**, and no attaching the same object
twice. Moving a card between columns keeps its attachments because they key on
the card, not the column; there is no other move.

**No virus scanning.** It would be a third-party sub-processor seeing every
byte, and this app has no story for what to do with a positive. Named here so
that its absence is a decision on the record rather than an oversight.

**No attachments on comments.** They hang off a card. A comment thread with
files is a different feature.

## The conflict this spec exists to settle

`docs/specs/account-deletion.md` "Order" flagged it a sub-project ahead:

> a blob store cannot run against the Postgres in `docker-compose.yml`, and that
> is the same objection that disqualified Neon Auth.

That objection is real and it is upheld. `CLAUDE.md` rejects Neon Auth partly
because "it is a *hosted* service reached over a Neon-managed endpoint, so it
cannot run against the plain Postgres in `docker-compose.yml`. Adopting it would
break local development and self-hosting, which 'Deployment' commits to
supporting." Vercel Blob is the same shape of thing and was rejected for the
same reason, even though it would have added no new sub-processor.

**The resolution is the S3 API.** It is not one vendor's endpoint but a protocol
several implement, so one code path serves Cloudflare R2 in production and a
MinIO container in `docker-compose.yml`, with no adapter layer, no driver switch
by environment, and no second code path to rot. This is the same reasoning that
put the `node-postgres` driver against both Neon and local Postgres: one client,
two deployments.

The cost is honest and accepted: a fourth infrastructure vendor, a new row in
the `/privacy` sub-processor table, and one more service in `docker-compose.yml`.

## Deliverables

### Schema: `attachments`

```ts
export const attachmentStatus = pgEnum('attachment_status', ['pending', 'ready']);

export const attachments = pgTable(
  'attachments',
  {
    id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
    boardId: text('board_id')
      .notNull()
      .references(() => boards.id, { onDelete: 'cascade' }),
    cardId: text('card_id')
      .notNull()
      .references(() => cards.id, { onDelete: 'cascade' }),
    uploaderId: text('uploader_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    key: text('key').notNull().unique(),
    filename: text('filename').notNull(),
    contentType: text('content_type').notNull(),
    size: integer('size').notNull(),
    status: attachmentStatus('status').notNull().default('pending'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index('attachments_card_id_created_at_idx').on(t.cardId, t.createdAt),
    index('attachments_board_id_idx').on(t.boardId),
    index('attachments_uploader_id_idx').on(t.uploaderId),
  ],
);
```

- **`boardId` is denormalised deliberately**, the same trade `cards.boardId`
  already makes: every permission check and every realtime event keys off the
  board, and a board-wide delete needs the keys without joining through cards.
  Keep it consistent with `cardId`'s board on every write.
- **`cardId` cascades.** An attachment dies with its card, exactly as a comment
  does. Deleting a column never deletes cards, so no attachment is reachable
  that way.
- **`uploaderId` is nullable and sets null on delete, not cascade.** This is the
  account-deletion decision expressed as a foreign key: `/privacy` promises that
  boards owned by other people keep what you contributed, and a spec PDF on a
  colleague's card must not vanish because you closed your account. It is the
  identical rule `comments.authorId` and `cards.createdById` already follow. An
  attachment with no uploader can be deleted by the board owner and by nobody
  else, which the permission rule below already allows without a special case.
- **`attachments(uploaderId)`** exists for one query only: the per-account
  storage total. It is a sum over a column with no other reader, so it is worth
  saying plainly that the index has one job and dies with that cap.
- **`key` is unique** and shaped `boards/<boardId>/<attachmentId>`. The filename
  is *not* in the key: it would drag filename encoding into object naming for no
  gain, and the download route puts the real name in `Content-Disposition`
  instead. The board prefix is what makes deleting a whole board's objects one
  listing plus batched deletes rather than a query per card.
- **`status` is `'pending' | 'ready'`**, a `pgEnum` rather than a `text` column,
  because that is what `board_members.role` and `board_invites.role` already do
  with a closed set of values. Every read filters to `ready`. Unlike the caps
  above it *is* an invariant — a third state would be a design change, not a
  tuning change — so the database enforcing it is the right level.
- `size` is the **verified** byte count read back from the store, never the
  browser's claim. See "The handshake".

### Caps: `lib/attachments-limits.ts`

```ts
export const ATTACHMENT_SIZE_MAX = 10 * 1024 * 1024; //  10 MB, one file
export const ATTACHMENTS_PER_CARD = 10;
export const STORAGE_PER_BOARD = 1024 * 1024 * 1024; //   1 GB, one board
export const STORAGE_PER_ACCOUNT = 2 * 1024 * 1024 * 1024; // 2 GB, one uploader
export const FILENAME_MAX = 200;
export const PENDING_TTL_MINUTES = 15;
```

The module **imports nothing**, for the same reason `lib/labels-limits.ts`
imports nothing: the file picker is a client component and needs the size cap to
reject a file before uploading it. Anything reachable from `lib/permissions.ts`
or `lib/db` cannot be imported by a `'use client'` file without pulling the `pg`
driver into the browser bundle.

None of the six is a check constraint. All six are tunable product limits rather
than invariants — but `ATTACHMENT_SIZE_MAX` is load-bearing in a way the others
are not: 10 MB is the number that makes a single `PUT` always sufficient, so
raising it reopens "no multipart upload" above.

`PENDING_TTL_MINUTES` is how long an unconfirmed upload is believed to be still
in flight. Fifteen minutes is far longer than 10 MB can take and short enough
that an abandoned upload does not hold a slot against `ATTACHMENTS_PER_CARD` for
an afternoon.

### Where the two storage totals come from

The per-card cap bounds one card. It does not bound a board, and it does not
bound a person, so on its own a determined user simply makes more cards. Two
totals close that, and both are derived from R2's published pricing rather than
chosen for roundness. **Verified 2026-09-02:** the free tier is 10 GB-month of
storage, 1 million Class A operations and 10 million Class B; beyond it, storage
is $0.015 per GB-month, Class A $4.50 per million and Class B $0.36 per million.

**`STORAGE_PER_BOARD` = 1 GB.** The free tier is the anchor: at 1 GB a board,
**ten boards filled to their cap is exactly the 10 GB that costs nothing**, and
the eleventh costs 1.5 cents a month. That is the property worth having — the
service cannot generate a surprising bill, only a slowly growing legible one.
The cap is also generous against real use rather than against the worst case: a
screenshot is 200–500 KB, so 1 GB is several thousand of them, and hitting it
with 10 MB files takes a hundred of them on one board. A board that reaches
1 GB is a board doing something this app was not designed for.

The two caps do interact, and it is worth stating rather than discovering: at
10 files of 10 MB, one card can hold 100 MB, so **ten maximal cards exhaust a
board.** That is the intended shape — the per-card cap keeps a single card
sane, the board cap is what actually bounds the bill, and a board whose first
ten cards are full of 10 MB files should be stopped.

**`STORAGE_PER_ACCOUNT` = 2 GB**, counted as the bytes an account has uploaded
**across every board it can reach**, not the boards it owns. That is the
distinction that makes the second cap worth having at all: the board cap already
protects an owner from their own board, but nothing stops one member who has
been invited to eight boards from putting a gigabyte in each. Two gigabytes is
twice what any single board can hold, which is deliberately generous for an
honest heavy user — ten screenshots a day is roughly 1.5 GB a year — while
bounding one account's total contribution to a fifth of the free tier.

Both are current usage, not lifetime: deleting an attachment gives the space
back to both counters immediately.

**These two interact with account deletion in different directions, and that is
correct.** When an account is deleted its `uploaderId` goes null, so those bytes
stop counting against any account's quota while continuing to count against the
board's. The board is where the bytes physically are and where the bill lands;
the account quota is about who is currently spending, and a closed account is
not spending. A board carrying files from departed colleagues can therefore sit
near its cap with nobody's account quota reflecting it — the board owner's
remedy is the delete they already have over any file on their board.

### Storage: `lib/storage.ts`

Server-only, and the single place the bucket is spoken to:

```ts
presignPut(key: string, contentType: string): Promise<string>
presignGet(key: string, filename: string): Promise<string>
headObject(key: string): Promise<{ size: number; contentType: string } | null>
deleteObjects(keys: string[]): Promise<void>
storageConfigured(): boolean
```

`@aws-sdk/client-s3` and `@aws-sdk/s3-request-presigner`, configured entirely
from environment:

```
S3_ENDPOINT           # https://<account>.eu.r2.cloudflarestorage.com, or http://minio:9000
S3_REGION             # 'auto' for R2
S3_BUCKET
S3_ACCESS_KEY_ID
S3_SECRET_ACCESS_KEY
```

**Production is Cloudflare R2 on its EU-jurisdiction endpoint.** Verified from
Cloudflare's documentation on 2026-09-02: a bucket created against
`https://<account_id>.eu.r2.cloudflarestorage.com` is restricted to the EU
jurisdiction and is reachable *only* through that endpoint. That matters because
`/privacy` already pins Vercel to Frankfurt and Neon to `eu-central-1`; here the
residency claim is enforced by the endpoint rather than asserted in prose. Using
the plain `<account_id>.r2.cloudflarestorage.com` endpoint by mistake does not
silently write to the wrong place — it cannot see the bucket at all.

**Local development and self-hosting are MinIO**, added to `docker-compose.yml`
as one more service with a bucket created on first start. Same SDK, same code
path, different endpoint.

**When the five variables are absent the feature turns itself off.**
`storageConfigured()` is resolved on the server and passed down as a boolean the
way `canWrite` already is — never as configuration a client component reads. A
self-hoster who wants no bucket gets a board with no attachment surface rather
than a board with an upload button that fails.

### Reads: `lib/attachments.ts`

Mirroring `lib/labels.ts`, the read side lives apart from the actions:

```ts
cardAttachments(cardId: string): Promise<CardAttachment[]>   // ready only
boardUsage(boardId: string): Promise<number>                 // bytes
uploaderUsage(userId: string): Promise<number>               // bytes, all boards
```

`boardUsage` and `uploaderUsage` are `sum(size)` over `ready` plus fresh
`pending` rows — the same set `requestUpload` reserves against, so the number a
user is shown and the number that refuses their upload can never disagree.

### Serving bytes: `app/api/attachments/[attachmentId]/route.ts`

A stable application URL, not a presigned link embedded in HTML. It re-checks
the session and calls `assertBoardAccess(userId, boardId, 'viewer')` on every
request — the route is authorisation, exactly as `CLAUDE.md` requires of every
route handler — then 302s to a short-lived presigned `GET`.

Two consequences worth stating:

- **Nothing expires inside rendered markup.** An inline `<img>` points at the
  app; the signature is minted per request and lives for seconds. A board left
  open overnight does not fill with broken images.
- **Losing access takes effect immediately.** A removed member's next request
  for a file 404s, because the permission is re-derived rather than baked into a
  link they still hold. A presigned URL already handed out stays valid until it
  expires — that window is seconds, and is the reason the TTL is short.

**One cost trap, found while doing the pricing arithmetic above.** A fresh
signature per request means a fresh *URL* per request, so every render of an
inline image is a browser cache miss and another Class B operation against the
bucket. The fix is to round the signing timestamp down to a five-minute window,
so the identical URL is produced throughout it and the browser's own HTTP cache
answers repeat renders, with the presigned TTL set to fifteen minutes so a URL
minted at the start of a window stays valid to the end of it. **Do not instead
cache the 302 itself** — that would stretch the revocation window from seconds
to minutes, and immediate revocation is the property this route exists to
provide.

The route sets `Content-Disposition: attachment` for everything except a small
allowlist of inline-safe image types: `image/png`, `image/jpeg`, `image/gif`,
`image/webp`, `image/avif`. **`image/svg+xml` is deliberately not on that list.**
An SVG is a document that can carry script, and a user who opens one in a tab
executes it. Served as a download it is inert.

## The handshake

The browser writes bytes the server never sees, so the declared size and content
type are the client's word until something checks. Three actions in
`lib/actions/attachments.ts`, following the conventions in `CLAUDE.md`:

**`requestUpload({ boardId, cardId, filename, contentType })`**

1. `assertBoardAccess(userId, boardId, 'member')`.
2. Reject a filename longer than `FILENAME_MAX`.
3. Sweep this card's `pending` rows older than `PENDING_TTL_MINUTES`, deleting
   their objects. This is the invite-expiry pattern — filter and clean at the
   point of use, because "Vercel rules out a scheduled job" — moved onto the
   write path, which is where the slot is being competed for.
4. Count `ready` rows plus surviving fresh `pending` rows against
   `ATTACHMENTS_PER_CARD`.
5. Sum `size` over the same set for this board, and separately for this
   uploader, and reserve the **declared** size against `STORAGE_PER_BOARD` and
   `STORAGE_PER_ACCOUNT`. Both sums count fresh `pending` rows, so two uploads
   started at once cannot each be told there is room for one of them.
6. Insert the row as `pending`.
7. Return `{ attachmentId, url }` where `url` is the presigned `PUT`.

**`confirmUpload({ boardId, attachmentId })`**

1. `assertBoardAccess(userId, boardId, 'member')`, and the row must be this
   user's own `pending` row.
2. `headObject(key)`. A missing object is `NOT_FOUND` — the upload never landed.
3. Compare the **real** size against `ATTACHMENT_SIZE_MAX` and record the real
   content type. Over the cap: delete the object, delete the row, return
   `TOO_LARGE`.
4. Re-run both storage totals against the **real** size, excluding this row's
   own reservation. Over either: delete the object, delete the row, return
   `BOARD_FULL` or `ACCOUNT_FULL`. The reservation at step 5 of `requestUpload`
   used a number the client supplied, so the quota is only actually enforced
   here — exactly as the per-file cap is.
5. Flip to `ready` in a transaction, then `publish` an `attachment.added` after
   it commits.

Verifying after the fact rather than preventing is a deliberate choice, and the
reason is worth recording: a presigned `PUT` cannot by itself refuse an
oversized body the way an S3 `POST` policy's `content-length-range` can. The
worst a liar achieves is writing an object that is immediately deleted and never
becomes an attachment. **Whether signing `content-length` also blocks it at the
R2 edge is not assumed here** — if it does, it is a bonus to be confirmed during
Section B and written down, not a mechanism this design leans on.

**`deleteAttachment({ boardId, attachmentId })`**

The uploader or the board owner. Row deleted in a transaction, object deleted
after the commit, `attachment.removed` published — the same ordering `publish`
already obeys everywhere, because "a rolled-back write that already announced
itself puts every other client into a state the database disagrees with".

## Permissions

- **`member` and above to attach.** A viewer can comment but cannot attach. A
  comment is speech and costs nothing; a file is billable bytes in somebody
  else's bucket, and a read-only account writing billable bytes is a kind of
  exposure this app does not have today.
- **The uploader or the board owner deletes.** This departs from the comment
  rule — where the author and *nobody else, not the board owner* can delete —
  and the departure is deliberate. The owner is accountable for what sits in
  their board's bucket and needs a way to remove a file without deleting the
  card around it, including a file left by somebody whose account is gone.
- **Any member of the board can read**, viewers included, through the download
  route. Reading is the same right as seeing the card.

## Bytes on cascade

Rows cascade in Postgres. Objects in a bucket do not. Four places delete rows
that own objects, and each must collect the keys **before** the transaction and
delete them after it commits:

| Where | Keys to collect |
|---|---|
| `deleteAttachment` | the one row |
| `deleteCard` | `where cardId = ?` |
| `deleteBoard` | `where boardId = ?` |
| `deleteAccount` | every board the departing user owns |

A failed bucket delete is **logged, not fatal.** The row is already gone; a
leaked object is cheaper and safer than a half-deleted board or an account
deletion that refuses to finish. The leak is accepted and documented rather than
swept, because the sweeper would be the scheduled job Vercel rules out — the
same trade `board_invites` already makes by leaving expired rows in place.

`deleteAccount` is the sharp one. It already runs "in one transaction" and is
already blocked while the user owns a board somebody else is a member of, so the
set of boards being destroyed is bounded to boards nobody else uses. Attachments
on *other people's* boards are not touched: their `uploaderId` goes null and the
file stays, which is the promise `/privacy` makes about contributions to boards
you do not own.

## The two surfaces

**The card modal** — `components/board/card-attachments.tsx`, a sibling of
`card-labels.tsx` and `card-comments.tsx`. Inline-safe images render at a
constrained height; everything else is a row carrying filename, size and a
download action. Files go in by picker or by dropping onto the modal.

The `PUT` goes through `XMLHttpRequest`, not `fetch`, because only XHR reports
upload progress and 10 MB on a bad connection needs a bar. The `pending` row is
the optimistic state — and unusually for optimistic UI it is *real*, a row that
exists in the database and is simply not shown to anybody else until it is
`ready`.

**A quota is only fair if you can see it coming.** The attachment section shows
nothing about storage until the board passes 80% of `STORAGE_PER_BOARD`, at
which point a mono line appears reading `847 MB of 1 GB used`. Below that
threshold it would be clutter on a surface that has none to spare; above it, it
is the warning that stops a refusal being a surprise. The account total is not
shown on the board at all — an account near its own cap learns so at the point
of refusal, because a per-board surface is the wrong place to report a
cross-board number.

Refusals name the number and the way out, per the copy rules — "This board has
used its 1 GB of attachment storage. Delete a file to make room." Never an
apology, and never a bare failure.

**The card face** — a mono paperclip and a count in the existing meta line,
beside the due date and the label line. `lib/boards.ts` carries the count per
card the way it already carries labels, and `lib/board-state.ts` keeps it live
on add and remove. No new colour: `CLAUDE.md` allows three roles and warm is
never at rest on the board except a due date.

## Realtime: two events, taking the union to twenty-one

```ts
| { type: 'attachment.added'; id: string; cardId: string; filename: string;
    contentType: string; size: number; createdAt: string;
    uploader: { id: string; name: string | null; image: string | null } | null }
| { type: 'attachment.removed'; id: string; cardId: string }
```

Both names go in `lib/events.ts`'s `BoardEvent` **and** in
`components/board/realtime.tsx`'s `EVENT_NAMES`. `EveryEventIsBound` fails
`pnpm typecheck` if only one is done; `EVENT_NAMES`'s own `satisfies` catches the
reverse. `lib/events.test.ts`'s hand-written list moves from nineteen names to
twenty-one — it is a second opinion, not the guarantee.

Neither payload needs a truncation branch. The largest is `attachment.added` with
a 200-character filename and a display name, comfortably under `PAYLOAD_CEILING`.
No event carries a URL: a client that receives one calls the download route,
which is where permission is re-checked anyway.

## Testing

- **Unit (Vitest)** — the three actions against the caps and the permission
  matrix; the key shape; the pending sweep at the TTL boundary; `confirmUpload`
  rejecting an object that is larger than it claimed; both storage totals at
  their boundary, including the case that matters most — a file whose *declared*
  size fits the quota and whose *real* size does not; that two concurrent
  `requestUpload` calls cannot both reserve the last megabyte; that a null
  `uploaderId` still counts against the board and no longer against any account;
  the download route's inline allowlist, including that `image/svg+xml` is
  forced to a download.
- **Storage (Vitest against MinIO)** — presign, put, head, delete, round-trip.
  CI gains a MinIO service alongside the throwaway Postgres it already runs.
- **e2e (Playwright)** — attach a file and see it on the card; the count on the
  card face; a viewer sees no upload control; a second browser sees an
  attachment appear without a reload.

## Sections and pull requests

One section, one branch, one PR, in this order:

- **A — storage foundation.** The table and its migration,
  `lib/attachments-limits.ts`, `lib/storage.ts`, MinIO in `docker-compose.yml`
  and in CI, `.env.example`. No UI, no actions.
  Branch `feat/attachments-storage`.
- **B — actions and the download route.** The three actions, the route handler,
  the permission matrix, the sweep, both storage totals enforced in both phases,
  the `/privacy` changes, and their tests. Branch `feat/attachments-actions`.
- **C — the card modal.** The list, inline images, upload with progress, delete,
  and the 80% usage line. Branch `feat/attachments-modal`.
- **D — face and realtime.** The board-query count, `toBoardState`, the two
  events published and bound, and the two-client e2e.
  Branch `feat/attachments-realtime`.

B depends on A, C on B, D on C. Branch each from `main` once its parent has
landed rather than stacking — `CLAUDE.md` records two stacks that stranded a
child PR on a consumed base.

`/privacy` moves in Section B rather than Section A. Section A ships no code
that reaches Cloudflare — no account or bucket exists, and there is no action
or interface yet through which a user could attach anything — so naming
Cloudflare as a sub-processor and asserting an EU-residency claim in Section A
would be publishing a legal document about a system that has not sent it a
single byte. Section B is the pull request in which Cloudflare first can
receive one: the actions and the download route exist there, even with no UI
in front of them yet.

## Verification

Ticked only against observed output, per section. Section D worked this list on
2026-09-02; what is still open says why, rather than being ticked off something
that did not actually check it.

- [x] `pnpm typecheck && pnpm lint && pnpm test && pnpm build` all pass, each
      exit code read from its own redirected log, never through a pipe.
      Observed on `feat/attachments-realtime`: `TYPECHECK=0 LINT=0 TEST=0
      BUILD=0`, unit run 528 passed | 8 skipped.
- [ ] `pnpm exec playwright test` passes with the count run equal to the count
      collected. 144 collected, 143 passed, **1 failed** — a due-date test in
      `e2e/card-modal.spec.ts` timing out in `written()` waiting for a POST.
      It is a pre-existing flake, not Section D's: it fails the same way on
      `main` (143 collected, 142 passed, same test), fails on a *different*
      due-date test between two runs of the same branch, and passes 17/17 when
      that file runs alone. Left open deliberately — it needs its own fix, and
      ticking this box would hide it.
- [ ] The migration applies to an empty database in CI, and is run against
      production by hand when Section A lands. CI's half is green. **The
      production half is unverified** — reading it back needs
      `neonctl connection-string main`, which this session could not run. Do
      not assume it applied; `CLAUDE.md` records what that assumption cost
      once already. Confirm `attachments` is in `information_schema.tables`
      and that `drizzle.__drizzle_migrations` holds seven rows against the
      seven files in `lib/db/migrations/`.
- [ ] `docker compose up --build` gives a working board with working
      attachments against MinIO — no Cloudflare credentials present.
- [x] With the five `S3_*` variables unset, the board still loads and shows no
      attachment surface. Observed: with the `S3_*` lines removed from
      `.env.local` (they come from there, not the shell, so `env -u` would
      have proved nothing) `pnpm build` exits 0, and `e2e/card-modal.spec.ts`
      plus `e2e/cards.spec.ts` run 24 passed against that build — only the
      pre-existing due-date flake above failing. `CardAttachments` returns
      null for `storageEnabled={false}` with no attachments, covered by
      `components/board/card-attachments.test.tsx`.
- [ ] An object uploaded larger than it declared is rejected by `confirmUpload`
      and is gone from the bucket afterwards — confirmed by listing the bucket,
      not by reading the action's return value.
- [ ] A board at its storage cap refuses the next upload, names the number, and
      accepts it again once a file is deleted.
- [ ] An upload whose declared size fits the board quota but whose real size
      does not is rejected at confirm and leaves nothing in the bucket.
- [ ] Deleting a card removes its objects from the bucket — confirmed by
      listing the bucket.
- [ ] A `.svg` attachment downloads rather than rendering, confirmed from the
      response headers. Both halves are observed, the single end-to-end request
      is not: `lib/storage.test.ts`'s real-bucket block, run against MinIO with
      the `S3_*` variables exported into the shell, reads
      `content-disposition: attachment; filename="greeting.txt"` back off a
      real presigned GET (14 passed, 0 skipped); and
      `app/api/attachments/[attachmentId]/route.test.ts` asserts an
      `image/svg+xml` row presigns with `inline=false`. Nobody has yet followed
      a live `/api/attachments/<id>` 302 and read the header off the far end.

      Note for whoever does: that real-bucket block **skips silently** under a
      plain `pnpm test`, because vitest does not load `.env.local` — 8 skipped,
      reported as a pass. Its own first test only enforces `storageConfigured()`
      when `CI === 'true'`. Export the variables before trusting it locally.
- [ ] The production bucket is on the EU jurisdiction endpoint — confirmed by
      the fact that the plain endpoint cannot see it. Needs the production
      Cloudflare credentials, which this session did not have.
- [ ] Two real browsers: one attaches a file, the other's card shows the count
      without a reload. `e2e/attachments.spec.ts` proves this across two
      Playwright browser contexts on a real Pusher channel — the watcher never
      reloads, and waits for `data-realtime="subscribed"` before the actor
      writes, so a pass cannot come from anything but the event. Left open
      because the box asks for two *real* browsers and a Playwright run is not
      that; `docs/plans/realtime.md` has the precedent for saying so plainly
      rather than ticking it.

## Documentation changed in the same pull requests

- `CLAUDE.md` "Data model" — the table, its three cascades and the reason each
  differs, and the six caps, including the free-tier arithmetic behind the two
  storage totals.
- `CLAUDE.md` "Realtime" — "all nineteen" becomes twenty-one, with the two
  names.
- `CLAUDE.md` "Layout" — `lib/storage.ts`, `lib/actions/attachments.ts`,
  `app/api/attachments/`.
- `CLAUDE.md` "Deployment" — the five `S3_*` variables, the MinIO service, and
  the note that R2's EU jurisdiction is reachable on one endpoint only.
- `CLAUDE.md` "Auth and permissions" — the one-line exception that an
  attachment, unlike a comment, can be deleted by the board owner, and why.
- `CLAUDE.md` "Open decisions" — attachments resolved; the activity log and
  board archive versus hard delete remain.
- `/privacy` — Cloudflare R2 in the sub-processor table, attachments in what is
  collected, and retention.
- `/account` danger zone — files on other people's boards outlive the account,
  the same sentence comments already get.

## Settled while brainstorming

**The S3 API beat a hosted blob store.** Vercel Blob would have added no new
sub-processor and less code, and it lost anyway: it cannot run in
`docker-compose.yml`, and that is the precise objection `CLAUDE.md` uses to
disqualify Neon Auth. Rejected alongside it: a Vercel-Blob-plus-local-disk
adapter, because it buys the same outcome with two code paths and the local one
would rot; and `bytea` in Postgres, which streams every download through a
function and prices blob storage as rows.

**Any file beat images-only, and beat links-only.** Links to files elsewhere
would have avoided storage entirely and were rejected as not being the feature.

**Verify-after beat prevent-at-the-edge**, because the prevention a presigned
`PUT` can offer is not airtight and the cost of being wrong is one deleted
object.

**A pending row beat inserting on confirm.** Confirm-only is one fewer state,
and it makes an abandoned upload an orphan nothing in the database can ever
name. A leak you can find is worth a status column.

**The owner's delete beat consistency with comments.** The comment rule protects
speech from the person hosting it; that reasoning does not transfer to a file
the host is paying to store.

**Member-only upload beat matching the comment permission.** A viewer who can
write words cannot write bytes, because bytes have a bill.

**A count on the card face beat a thumbnail.** A thumbnail puts arbitrary user
colour on the one surface whose whole design rests on colour being functional,
and it destroys uniform card height.

**10 MB was chosen so that one `PUT` is always enough**, which is what keeps
multipart, resumability and progress-restore out of this spec.

**The storage totals were derived from the free tier, not guessed.** 1 GB a
board makes ten full boards exactly the 10 GB that costs nothing; 2 GB an
account is twice what one board can hold, which bounds an invited member without
constraining an honest one. Rejected: leaving both open until the service has
users, which was this spec's own first answer and is the wrong one — a quota
retrofitted onto boards that already exceed it forces either grandfathering or
taking storage away from people who did nothing wrong.

**The two totals count different things on purpose.** Per-board is where the
bytes are and where the bill lands; per-account is who is currently spending.
Making the second "boards you own" instead would have been nearly a restatement
of the first, and would have left the case it exists for — one member invited to
many boards — completely uncovered.

## Open decisions carried forward

- **Raising either storage total is a pricing decision, not a config change.**
  Both numbers are tied to R2's 10 GB free tier by the arithmetic above, so
  moving one moves where the service starts costing money. Re-derive rather than
  bump.
- **No usage surface for an account.** A user cannot see their own 2 GB total
  anywhere; they meet it at the point of refusal. `/account` is where it would
  go if this turns out to matter, and it is deliberately not built now.
- **Paste-to-attach**, listed under non-goals, is the most likely first
  addition.
- The activity log, and board archive versus hard delete, remain open and are
  untouched by this spec.
