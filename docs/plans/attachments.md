# Attachments — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A member attaches files up to 10 MB to a card, everyone on the board can see and download them, and images render inline in the card modal.

**Architecture:** An `attachments` table, and bytes in an S3-compatible bucket the browser writes to directly through a presigned `PUT`. The server never touches the bytes, so a two-phase handshake — a `pending` row, then a `HEAD` that verifies the real size and type — is what makes the caps real. `lib/storage.ts` is the only module that speaks to the bucket, configured entirely from environment, so Cloudflare R2 in production and a MinIO container locally are the same code path. Reads go out through one route handler that re-checks board access and redirects to a short-lived presigned `GET`, so nothing that expires is ever baked into rendered markup. Two new Pusher events keep an open board honest.

**Tech Stack:** Next.js 16 (App Router, Server Components), TypeScript strict, drizzle-orm 0.45.2 + drizzle-kit, Zod 4.5.4, Postgres (Neon `dev` branch locally), `@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner`, MinIO (local + CI), Cloudflare R2 (production), Vitest, Playwright, Pusher Channels, Tailwind v4.

**Spec:** `docs/specs/attachments.md` — read it before Task A1 and keep it open; this plan argues from it.

## Global Constraints

Every task's requirements implicitly include all of these.

- **The caps, defined once in `lib/attachments-limits.ts`:** `ATTACHMENT_SIZE_MAX` = 10 MB, `ATTACHMENTS_PER_CARD` = 10, `STORAGE_PER_BOARD` = 1 GB, `STORAGE_PER_ACCOUNT` = 2 GB, `FILENAME_MAX` = 200, `PENDING_TTL_MINUTES` = 15. That module **imports nothing** — the file picker is a client component and needs the size cap. None of them is a check constraint; `CLAUDE.md` reserves database constraints for invariants.
- **Action shape, in this order:** `auth()` → `safeParse` → resolve the board from the row → `assertBoardAccess` → transaction → publish after the transaction commits → return a discriminated `{ ok }` object. Never throw for an expected failure. The house example is `lib/actions/labels.ts`; copy its shape, not a remembered one.
- **`lib/permissions.ts`, `lib/events.ts`, `lib/db` and `lib/storage.ts` are server-only.** A `'use client'` file importing any *value* from them pulls the pg pool, the Pusher SDK or the AWS SDK into the browser bundle. For `lib/permissions.ts`, `lib/events.ts` and `lib/db` that build still fails — `pg`'s use of Node built-ins (`dns`/`fs`/`net`/`tls`) has no browser shim, so `pnpm build` catches it, and typecheck, lint and test all pass on that code regardless. **`lib/storage.ts` is different and needs its own guard**: `@aws-sdk/client-s3` ships a real browser build, so nothing — not even `pnpm build` — would fail; the module would just compile into the client bundle and silently ship the SDK while `storageConfigured()` answers `false` in the browser. That module therefore starts with `import 'server-only';`, which turns the same mistake into an explicit build-time error instead of a silent bundle. `import type` is erased and is always safe, everywhere.
- **Every export of a `'use server'` module is a callable endpoint.** A helper exported from `lib/actions/attachments.ts` is reachable from any browser, so anything that is not a permission-checking action belongs in `lib/storage.ts` or `lib/attachments.ts` instead. This is why `forgetObjects` lives in the storage module: exported from the actions module it would be an unauthenticated "delete these object keys" API.
- **Never trust an id from the client for authorisation**, and that includes `attachmentId`. Every action and the download route resolve the board from the row and check access against it.
- **The bytes are never trusted either.** Size and content type on the way in are the client's claim; the values that get stored are the ones `headObject` reads back. This is the single most important behaviour in the feature — see Task B3.
- **Publish after the transaction commits, never inside it.** A rolled-back write that already announced itself puts every other client into a state the database disagrees with.
- **Bucket deletes are best-effort and are issued after the commit.** A failure is logged, never thrown: the row is already gone, and a leaked object is cheaper than a half-deleted board.
- **No new colour role.** `CLAUDE.md` allows three — flow, accent, warning — and warm is never at rest on the board except a due date. The card face gets a mono paperclip and a count in the existing meta line, nothing else.
- **Copy:** active voice, sentence case, no filler. Errors say what happened and what to do, and never apologise. "This board has used its 1 GB of attachment storage. Delete a file to make room."
- **No `any`, no non-null assertions, no `@ts-expect-error` without an explanation on the line above. No unnecessary comments** — comment a non-obvious decision, never what the code plainly says.
- **Before claiming any task done:** `pnpm typecheck && pnpm lint && pnpm test`, each exit code read from its own redirected log. A pipe reports the exit code of `tail`, not of the test run:
  ```bash
  pnpm test > /tmp/unit.log 2>&1; echo "EXIT=$?"; tail -5 /tmp/unit.log
  ```
- **Commit per task**, imperative subject, each commit leaving the app working. Tick this plan's checkboxes in the same PR that does the work.
- **Implementation and per-task review run on Sonnet**; the final whole-branch review runs on Opus.

## File structure

| File | Responsibility |
|---|---|
| `lib/attachments-limits.ts` | The six caps. Imports nothing |
| `lib/attachments-limits.test.ts` | The free-tier arithmetic, and that the module stays import-free |
| `lib/db/schema.ts` | Add `attachmentStatus`, `attachments`, and the relations |
| `lib/db/migrations/0006_*.sql` | Generated, never hand-edited |
| `lib/storage.ts` | The only module that speaks S3. Presign, head, delete, and `storageConfigured` |
| `lib/storage.test.ts` | Round-trip against MinIO, skipped when unconfigured |
| `lib/attachments.ts` | Reads: `cardAttachments`, `boardUsage`, `uploaderUsage` |
| `lib/attachments.test.ts` | Usage sums include fresh pending rows and exclude stale ones |
| `lib/actions/attachments.ts` | `requestUpload`, `confirmUpload`, `deleteAttachment` |
| `lib/actions/attachments.test.ts` | Guard order, error codes, the declared-vs-real size check, quota boundaries |
| `app/api/attachments/[attachmentId]/route.ts` | Access re-check, then 302 to a presigned GET |
| `app/api/attachments/[attachmentId]/route.test.ts` | The inline allowlist, and that SVG is forced to a download |
| `lib/events.ts` | The two event names, added in Section D |
| `components/board/realtime.tsx` | `EVENT_NAMES` gains the same two names, Section D |
| `components/board/card-attachments.tsx` | `'use client'` — the modal's list, uploader and usage line |
| `components/board/card-body.tsx` | Slots the attachments section into the card |
| `components/board/board-card.tsx` | The mono paperclip and count on the card face |
| `lib/boards.ts` | The board query carries each card's attachment count |
| `lib/board-state.ts` | `StateCard.attachmentCount`, and the two reducer cases |
| `docker-compose.yml` | The MinIO service and its one-shot bucket init |
| `.github/workflows/ci.yml` | MinIO started as a step, not a service — see Task A2 |
| `e2e/schema.spec.ts` | The cascades and the set-null this table adds |
| `e2e/attachments.spec.ts` | The flows, grown across Sections B, C and D |
| `app/(legal)/privacy/page.tsx` | Cloudflare R2 as a sub-processor, and attachments in retention |

---

# Section A — storage foundation

No UI, no actions, no events. Everything needed to put a byte in a bucket and a row in a table. The legal page moves to Section B — the pull request where Cloudflare can first receive a byte, not this one. Branch `feat/attachments-storage` from `main`.

### Task A1: The caps

**Files:**
- Create: `lib/attachments-limits.ts`
- Test: `lib/attachments-limits.test.ts`

**Interfaces:**
- Produces, all from `lib/attachments-limits.ts`: `ATTACHMENT_SIZE_MAX`, `ATTACHMENTS_PER_CARD`, `STORAGE_PER_BOARD`, `STORAGE_PER_ACCOUNT`, `FILENAME_MAX`, `PENDING_TTL_MINUTES` — all `number` — plus `INLINE_IMAGE_TYPES: readonly string[]` and `rendersInline(contentType: string): boolean`. This is the import-free module that both the server and the client read from.

- [x] **Step 1: Write the failing test**

Create `lib/attachments-limits.test.ts`. These assert the *reasoning* behind the numbers, not the numbers themselves — a future change that keeps the arithmetic honest should pass, and one that quietly breaks the free-tier anchor should fail. The import-free check follows the precedent in `lib/events.test.ts`, which reads a file rather than importing it.

```ts
import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';

import {
  ATTACHMENTS_PER_CARD,
  ATTACHMENT_SIZE_MAX,
  FILENAME_MAX,
  PENDING_TTL_MINUTES,
  STORAGE_PER_ACCOUNT,
  STORAGE_PER_BOARD,
  rendersInline,
} from '@/lib/attachments-limits';

// Verified 2026-09-02 from Cloudflare's pricing page: R2's free tier is
// 10 GB-month of storage, and Standard storage is $0.015 per GB-month beyond it.
const R2_FREE_TIER_BYTES = 10 * 1024 * 1024 * 1024;

describe('the storage caps are derived, not picked', () => {
  test('ten boards filled to the board cap is exactly the free tier', () => {
    expect(STORAGE_PER_BOARD * 10).toBe(R2_FREE_TIER_BYTES);
  });

  test('an account can hold twice what one board can', () => {
    expect(STORAGE_PER_ACCOUNT).toBe(STORAGE_PER_BOARD * 2);
  });

  test('a single maximal card cannot fill a board on its own', () => {
    expect(ATTACHMENT_SIZE_MAX * ATTACHMENTS_PER_CARD).toBeLessThan(STORAGE_PER_BOARD);
  });

  test('one file is small enough that a single PUT is always enough', () => {
    // The spec's "no multipart upload" rests on this. Raising it reopens that.
    expect(ATTACHMENT_SIZE_MAX).toBeLessThanOrEqual(10 * 1024 * 1024);
  });

  test('an abandoned upload is believed in flight for longer than one can take', () => {
    expect(PENDING_TTL_MINUTES).toBeGreaterThanOrEqual(15);
  });

  test('a filename cap exists and is not absurd', () => {
    expect(FILENAME_MAX).toBe(200);
  });

  test('the account cap is larger than a 32-bit integer', () => {
    // Load-bearing for lib/attachments.ts: sum(size) must be cast to bigint,
    // not int. int4 tops out at 2,147,483,647 and STORAGE_PER_ACCOUNT is
    // 2,147,483,648 — one byte over. An int cast would overflow at exactly the
    // boundary the cap is meant to enforce.
    expect(STORAGE_PER_ACCOUNT).toBeGreaterThan(2 ** 31 - 1);
  });
});

describe('the inline allowlist', () => {
  test('renders common raster images inline', () => {
    expect(rendersInline('image/png')).toBe(true);
    expect(rendersInline('image/jpeg')).toBe(true);
  });

  test('never renders SVG inline', () => {
    // An SVG can carry script. This assertion is the whole reason the
    // allowlist is a list rather than a `startsWith('image/')` check.
    expect(rendersInline('image/svg+xml')).toBe(false);
  });

  test('never renders anything that is not an image', () => {
    expect(rendersInline('text/html')).toBe(false);
    expect(rendersInline('application/pdf')).toBe(false);
  });
});

test('the module imports nothing, so a client component can read the caps', () => {
  // lib/permissions.ts and lib/db build a pg pool at module scope. Anything
  // this module imported would travel with it into the browser bundle, and
  // only `pnpm build` would catch it.
  const source = readFileSync(new URL('./attachments-limits.ts', import.meta.url), 'utf8');
  expect(source).not.toMatch(/^\s*import\s/m);
});
```

- [x] **Step 2: Run the test and watch it fail**

```bash
pnpm exec vitest run lib/attachments-limits.test.ts > /tmp/a1.log 2>&1; echo "EXIT=$?"; tail -20 /tmp/a1.log
```

Expected: FAIL — `Failed to resolve import "@/lib/attachments-limits"`.

- [x] **Step 3: Write the module**

Create `lib/attachments-limits.ts`:

```ts
// Nothing may be imported here. The file picker is a client component and
// needs ATTACHMENT_SIZE_MAX, so anything this module pulled in would land in
// the browser bundle — see lib/labels-limits.ts, which exists for the same
// reason.

export const ATTACHMENT_SIZE_MAX = 10 * 1024 * 1024;
export const ATTACHMENTS_PER_CARD = 10;

// Ten boards at STORAGE_PER_BOARD is exactly R2's 10 GB-month free tier, so
// the service cannot produce a surprising bill — only a slowly growing legible
// one. STORAGE_PER_ACCOUNT counts an uploader across every board they can
// reach, which is what bounds one member invited to many boards; the board cap
// alone cannot see that. docs/specs/attachments.md holds the arithmetic.
export const STORAGE_PER_BOARD = 1024 * 1024 * 1024;
export const STORAGE_PER_ACCOUNT = 2 * 1024 * 1024 * 1024;

export const FILENAME_MAX = 200;
export const PENDING_TTL_MINUTES = 15;

// Rendered inline; everything else is forced to a download. image/svg+xml is
// deliberately absent — an SVG is a document that can carry script, and a
// viewer who opens one in a tab executes it. Served as a download it is inert.
export const INLINE_IMAGE_TYPES = [
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'image/avif',
] as const;

export function rendersInline(contentType: string): boolean {
  return (INLINE_IMAGE_TYPES as readonly string[]).includes(contentType);
}
```

- [x] **Step 4: Run the test and watch it pass**

```bash
pnpm exec vitest run lib/attachments-limits.test.ts > /tmp/a1.log 2>&1; echo "EXIT=$?"; tail -20 /tmp/a1.log
```

Expected: PASS, 11 tests.

- [x] **Step 5: Commit**

```bash
git add lib/attachments-limits.ts lib/attachments-limits.test.ts
git commit -m "feat: add the attachment caps, derived from R2's free tier"
```

---

### Task A2: MinIO locally and in CI

**Files:**
- Modify: `docker-compose.yml`
- Modify: `.github/workflows/ci.yml`
- Modify: `.env.example`

**Interfaces:**
- Produces: a reachable S3 endpoint at `http://localhost:9000` with bucket `kanban-attachments`, and the five `S3_*` variables set in CI and documented in `.env.example`. Task A4's tests depend on this existing.

**Why MinIO is a step in CI and a service in compose:** GitHub Actions' `services:` block runs a container with its image's default command and provides **no way to override it**. The `minio/minio` image needs `server /data`, so it cannot be a service. Starting it with an explicit `docker run` step is fully under our control and avoids relying on a third-party image's default entrypoint.

- [x] **Step 1: Add the MinIO service to `docker-compose.yml`**

Insert after the `postgres` service, before `app`:

```yaml
  minio:
    image: minio/minio:latest
    command: server /data --console-address ":9001"
    environment:
      MINIO_ROOT_USER: kanban
      MINIO_ROOT_PASSWORD: kanban-local-only
    ports:
      - '9000:9000'
      - '9001:9001'
    volumes:
      - miniodata:/data
    healthcheck:
      test: ['CMD', 'mc', 'ready', 'local']
      interval: 5s
      timeout: 5s
      retries: 10

  # One-shot: creates the bucket and exits. The app must never create its own
  # bucket — that would be boot-time state, which CLAUDE.md's deployment rules
  # rule out.
  minio-init:
    image: minio/mc:latest
    depends_on:
      minio:
        condition: service_healthy
    entrypoint: >
      /bin/sh -c "
      mc alias set local http://minio:9000 kanban kanban-local-only &&
      mc mb --ignore-existing local/kanban-attachments
      "
```

- [x] **Step 2: Give the app the bucket, in the same file**

Add to the `app` service's `environment:` block, after `PUSHER_SECRET`, and add `minio-init` to its `depends_on`:

```yaml
      # Server-side only and read at runtime, so not build arguments. Absent
      # these five the board still works and shows no attachment surface.
      S3_ENDPOINT: http://minio:9000
      S3_REGION: us-east-1
      S3_BUCKET: kanban-attachments
      S3_ACCESS_KEY_ID: kanban
      S3_SECRET_ACCESS_KEY: kanban-local-only
```

```yaml
    depends_on:
      postgres:
        condition: service_healthy
      minio-init:
        condition: service_completed_successfully
```

- [x] **Step 3: Add the volume**

```yaml
volumes:
  pgdata:
  miniodata:
```

- [x] **Step 4: Verify compose actually comes up**

```bash
docker compose up -d minio minio-init > /tmp/a2.log 2>&1; echo "EXIT=$?"; tail -20 /tmp/a2.log
docker compose ps
```

Expected: `minio` running and healthy, `minio-init` exited 0. Then confirm the bucket is really there rather than trusting the exit code:

```bash
docker compose run --rm --entrypoint sh minio-init -c \
  "mc alias set local http://minio:9000 kanban kanban-local-only >/dev/null && mc ls local/"
```

Expected: a line naming `kanban-attachments`.

- [x] **Step 5: Start MinIO in CI**

In `.github/workflows/ci.yml`, add these five to the `env:` block:

```yaml
      S3_ENDPOINT: http://localhost:9000
      S3_REGION: us-east-1
      S3_BUCKET: kanban-attachments
      S3_ACCESS_KEY_ID: kanban
      S3_SECRET_ACCESS_KEY: kanban-ci-only
```

And add this step immediately after `- uses: actions/checkout@v7`, before the pnpm setup:

```yaml
      # Not a `services:` entry: that block runs the image's default command
      # and cannot override it, and minio/minio needs `server /data`.
      - name: Start MinIO
        run: |
          docker run -d --name minio -p 9000:9000 \
            -e MINIO_ROOT_USER=kanban \
            -e MINIO_ROOT_PASSWORD=kanban-ci-only \
            minio/minio:latest server /data
          for i in $(seq 1 30); do
            if curl -sf http://localhost:9000/minio/health/live; then break; fi
            sleep 1
          done
          curl -sf http://localhost:9000/minio/health/live
          docker run --rm --network host --entrypoint sh minio/mc:latest -c "
            mc alias set ci http://localhost:9000 kanban kanban-ci-only &&
            mc mb --ignore-existing ci/kanban-attachments"
```

The final unpiped `curl` is the gate: if MinIO never came up, the step fails here rather than thirty lines later inside a confusing test failure.

**The bucket must be created here, not in a test's `beforeAll`.** CI has no
`minio-init` — compose does — so without this the storage tests meet
`NoSuchBucket` in CI while passing locally. Creation stays in infrastructure
because the app must never create its own bucket; putting it in a suite's setup
would hide the same gap from any future non-test consumer. Note `--entrypoint sh`:
the `minio/mc` image's entrypoint is `mc` itself, so `sh -c` alone does not work —
the same form `minio-init` already uses. The credentials here are CI's
(`kanban-ci-only`), not compose's.

- [x] **Step 6: Document the five variables in `.env.example`**

Append, after the Pusher block:

```
# Attachment storage, S3-compatible. Absent these five the app runs with no
# attachment surface at all, which is the supported no-bucket configuration.
# Local development uses the MinIO from docker-compose.yml.
S3_ENDPOINT=http://localhost:9000
S3_REGION=us-east-1
S3_BUCKET=kanban-attachments
S3_ACCESS_KEY_ID=kanban
S3_SECRET_ACCESS_KEY=kanban-local-only
```

Production uses Cloudflare R2 on its **EU-jurisdiction** endpoint,
`https://<account_id>.eu.r2.cloudflarestorage.com`, with `S3_REGION=auto`. A
bucket created there is restricted to the EU and is reachable only through that
endpoint — using the plain `r2.cloudflarestorage.com` host does not silently
write elsewhere, it cannot see the bucket at all.

- [x] **Step 7: Commit**

```bash
git add docker-compose.yml .github/workflows/ci.yml .env.example
git commit -m "chore: run MinIO locally and in CI for attachment storage"
```

---

### Task A3: The `attachments` table

**Files:**
- Modify: `lib/db/schema.ts`
- Create: `lib/db/migrations/0006_*.sql` (generated — never hand-edited)
- Modify: `e2e/schema.spec.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `attachmentStatus` (a `pgEnum`) and `attachments`, both exported from `lib/db/schema.ts`; `cards.attachments` as a `many` relation so the board query can count them in one round trip.

- [x] **Step 1: Write the failing test**

Add to `e2e/schema.spec.ts`. These are database invariants — cascades and set-null are Postgres's behaviour, not Zod's, which is why they live here rather than in Vitest. Follow the existing file's shape: seed, act through a raw `Pool`, assert, clean up in `finally`.

```ts
test('deleting a card takes its attachments with it', async ({ context }) => {
  const { userId } = await seedSession(context);
  const boardId = await seedBoard(userId, 'Attachment cascade');
  const [first] = await boardColumns(boardId);
  const cardId = await seedCard(first.id, { boardId, createdById: userId });

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    await pool.query(
      `insert into attachments
         (id, board_id, card_id, uploader_id, key, filename, content_type, size, status)
       values ($1, $2, $3, $4, $5, 'notes.pdf', 'application/pdf', 1024, 'ready')`,
      ['att-cascade', boardId, cardId, userId, `boards/${boardId}/att-cascade`],
    );

    await pool.query('delete from cards where id = $1', [cardId]);

    const { rows } = await pool.query<{ n: number }>(
      'select count(*)::int as n from attachments where card_id = $1',
      [cardId],
    );
    expect(rows[0].n, 'attachments should be empty').toBe(0);
  } finally {
    await pool.end();
    await removeSeededUser(userId);
  }
});

test('deleting the uploader keeps the file and nulls the uploader', async ({ context }) => {
  // The mirror of comments.authorId: /privacy promises boards owned by other
  // people keep what you contributed. A cascade here would delete a colleague's
  // spec from a board you never owned.
  const { userId } = await seedSession(context);
  const owner = await seedSession(context);
  const boardId = await seedBoard(owner.userId, 'Uploader leaves');
  await seedMember(boardId, userId, 'member');
  const [first] = await boardColumns(boardId);
  const cardId = await seedCard(first.id, { boardId, createdById: owner.userId });

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    await pool.query(
      `insert into attachments
         (id, board_id, card_id, uploader_id, key, filename, content_type, size, status)
       values ($1, $2, $3, $4, $5, 'spec.pdf', 'application/pdf', 2048, 'ready')`,
      ['att-survives', boardId, cardId, userId, `boards/${boardId}/att-survives`],
    );

    await removeSeededUser(userId);

    const { rows } = await pool.query<{ uploader_id: string | null }>(
      'select uploader_id from attachments where id = $1',
      ['att-survives'],
    );
    expect(rows, 'the attachment should still exist').toHaveLength(1);
    expect(rows[0].uploader_id, 'the uploader should be null').toBeNull();
  } finally {
    await pool.end();
    await removeSeededUser(owner.userId);
  }
});

test('two attachments cannot share an object key', async ({ context }) => {
  const { userId } = await seedSession(context);
  const boardId = await seedBoard(userId, 'Key uniqueness');
  const [first] = await boardColumns(boardId);
  const cardId = await seedCard(first.id, { boardId, createdById: userId });

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const insert = (id: string) =>
      pool.query(
        `insert into attachments
           (id, board_id, card_id, uploader_id, key, filename, content_type, size, status)
         values ($1, $2, $3, $4, 'boards/shared/key', 'a.png', 'image/png', 10, 'ready')`,
        [id, boardId, cardId, userId],
      );

    await insert('att-key-1');
    await expect(insert('att-key-2')).rejects.toThrow(/duplicate key/i);
  } finally {
    await pool.end();
    await removeSeededUser(userId);
  }
});
```

- [x] **Step 2: Run the test and watch it fail**

```bash
pnpm exec playwright test e2e/schema.spec.ts --reporter=line > /tmp/a3.log 2>&1; echo "EXIT=$?"; tail -20 /tmp/a3.log
```

Expected: FAIL — `relation "attachments" does not exist`.

- [x] **Step 3: Add the table to `lib/db/schema.ts`**

Place it after `cardLabels`, keeping the file's existing order of table then relations. `integer` and `pgEnum` are already imported at the top of this file — do not re-add them.

```ts
export const attachmentStatus = pgEnum('attachment_status', ['pending', 'ready']);

export const attachments = pgTable(
  'attachments',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    // Denormalised for the same reason cards.boardId is: every permission
    // check and every event keys off the board, and a board-wide delete needs
    // the object keys without joining through cards.
    boardId: text('board_id')
      .notNull()
      .references(() => boards.id, { onDelete: 'cascade' }),
    cardId: text('card_id')
      .notNull()
      .references(() => cards.id, { onDelete: 'cascade' }),
    // Set null, not cascade — the rule comments.authorId already follows.
    // /privacy promises boards owned by other people keep your contributions.
    uploaderId: text('uploader_id').references(() => users.id, { onDelete: 'set null' }),
    key: text('key').notNull().unique(),
    filename: text('filename').notNull(),
    contentType: text('content_type').notNull(),
    // The value headObject read back, never the browser's claim.
    size: integer('size').notNull(),
    status: attachmentStatus('status').notNull().default('pending'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('attachments_card_id_created_at_idx').on(t.cardId, t.createdAt),
    index('attachments_board_id_idx').on(t.boardId),
    // One reader only: the per-account storage total.
    index('attachments_uploader_id_idx').on(t.uploaderId),
  ],
);
```

- [x] **Step 4: Add the relations, in the same file**

Add an `attachmentsRelations`, and extend the existing `cardsRelations` with an `attachments: many(attachments)` entry so `lib/boards.ts` can count them in one query:

```ts
export const attachmentsRelations = relations(attachments, ({ one }) => ({
  card: one(cards, { fields: [attachments.cardId], references: [cards.id] }),
  board: one(boards, { fields: [attachments.boardId], references: [boards.id] }),
  uploader: one(users, { fields: [attachments.uploaderId], references: [users.id] }),
}));
```

- [x] **Step 5: Generate and apply the migration**

```bash
pnpm db:generate > /tmp/a3gen.log 2>&1; echo "EXIT=$?"; tail -10 /tmp/a3gen.log
ls lib/db/migrations/ | tail -3
pnpm db:migrate > /tmp/a3mig.log 2>&1; echo "EXIT=$?"; tail -10 /tmp/a3mig.log
```

Expected: a new `0006_*.sql` exists and applies. **Never hand-edit it.** Confirm the table is really there rather than trusting the success line — `CLAUDE.md` records a case where `migrations applied successfully!` printed against the wrong database:

```bash
psql "$DATABASE_URL" -c '\d attachments'
```

- [x] **Step 6: Run the test and watch it pass**

```bash
pnpm exec playwright test e2e/schema.spec.ts --reporter=line > /tmp/a3.log 2>&1; echo "EXIT=$?"; tail -20 /tmp/a3.log
```

Expected: PASS, with the count that ran equal to the count collected.

- [x] **Step 7: Commit**

```bash
git add lib/db/schema.ts lib/db/migrations e2e/schema.spec.ts
git commit -m "feat: add the attachments table"
```

---

### Task A4: `lib/storage.ts`

**Files:**
- Create: `lib/storage.ts`
- Test: `lib/storage.test.ts`
- Modify: `package.json` (two dependencies)

**Interfaces:**
- Consumes: the five `S3_*` variables from Task A2.
- Produces, all from `lib/storage.ts`:
  - `storageConfigured(): boolean`
  - `objectKey(boardId: string, attachmentId: string): string`
  - `presignPut(key: string, contentType: string): Promise<string>`
  - `presignGet(key: string, filename: string, inline: boolean): Promise<string>`
  - `headObject(key: string): Promise<{ size: number; contentType: string } | null>`
  - `deleteObjects(keys: string[]): Promise<void>`
  - `forgetObjects(keys: string[]): Promise<void>` — `deleteObjects` with the failure swallowed and logged

- [x] **Step 1: Install the SDK**

```bash
pnpm add @aws-sdk/client-s3 @aws-sdk/s3-request-presigner
```

- [x] **Step 2: Write the failing test**

Create `lib/storage.test.ts`. This is an integration test against a real bucket, which is why it guards on configuration — a developer with no docker running must still get a green `pnpm test`. The `CI` assertion is what stops that guard turning into a silent skip where it matters:

```ts
import { beforeAll, describe, expect, test } from 'vitest';

import {
  deleteObjects,
  headObject,
  objectKey,
  presignGet,
  presignPut,
  storageConfigured,
} from '@/lib/storage';

test('storage is configured in CI, so the suite below never silently skips', () => {
  // A skipped integration suite reports as a pass. CLAUDE.md's rule about a
  // passing count not being a passing suite is exactly this failure mode.
  if (process.env.CI === 'true') expect(storageConfigured()).toBe(true);
});

describe.skipIf(!storageConfigured())('round trip against a real bucket', () => {
  const key = objectKey('board-storage-test', `att-${Date.now()}`);
  const body = Buffer.from('hello attachment');

  beforeAll(async () => {
    const url = await presignPut(key, 'text/plain');
    const response = await fetch(url, {
      method: 'PUT',
      body,
      headers: { 'content-type': 'text/plain' },
    });
    expect(response.ok, `presigned PUT failed: ${response.status}`).toBe(true);
  });

  test('headObject reads back the real size and type', async () => {
    const head = await headObject(key);
    expect(head).not.toBeNull();
    expect(head?.size).toBe(body.byteLength);
    expect(head?.contentType).toBe('text/plain');
  });

  test('headObject answers null for an object that is not there', async () => {
    expect(await headObject(objectKey('board-storage-test', 'never-uploaded'))).toBeNull();
  });

  test('a presigned GET returns the bytes and names the file', async () => {
    const url = await presignGet(key, 'greeting.txt', false);
    const response = await fetch(url);
    expect(await response.text()).toBe('hello attachment');
    expect(response.headers.get('content-disposition')).toContain('greeting.txt');
    expect(response.headers.get('content-disposition')).toContain('attachment');
  });

  test('deleteObjects removes it', async () => {
    await deleteObjects([key]);
    expect(await headObject(key)).toBeNull();
  });

  test('deleting nothing is not an error', async () => {
    // deleteCard on a card with no attachments calls this with an empty list.
    await expect(deleteObjects([])).resolves.toBeUndefined();
  });
});

test('the object key puts the board in the prefix', () => {
  // The board prefix is what makes deleting a whole board's objects one
  // listing rather than a query per card.
  expect(objectKey('b1', 'a1')).toBe('boards/b1/a1');
});
```

- [x] **Step 3: Run the test and watch it fail**

```bash
pnpm exec vitest run lib/storage.test.ts > /tmp/a4.log 2>&1; echo "EXIT=$?"; tail -20 /tmp/a4.log
```

Expected: FAIL — `Failed to resolve import "@/lib/storage"`.

- [x] **Step 4: Write the module**

Create `lib/storage.ts`:

```ts
import {
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

// Fifteen minutes, deliberately longer than the five-minute signing window
// below, so a URL minted at the start of a window is still valid at its end.
const SIGNED_URL_TTL_SECONDS = 15 * 60;
const SIGNING_WINDOW_MS = 5 * 60 * 1000;

function config() {
  const endpoint = process.env.S3_ENDPOINT;
  const region = process.env.S3_REGION;
  const bucket = process.env.S3_BUCKET;
  const accessKeyId = process.env.S3_ACCESS_KEY_ID;
  const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY;
  if (!endpoint || !region || !bucket || !accessKeyId || !secretAccessKey) return null;
  return { endpoint, region, bucket, accessKeyId, secretAccessKey };
}

export function storageConfigured(): boolean {
  return config() !== null;
}

function client() {
  const settings = config();
  if (!settings) throw new Error('Attachment storage is not configured');
  return {
    bucket: settings.bucket,
    s3: new S3Client({
      endpoint: settings.endpoint,
      region: settings.region,
      credentials: {
        accessKeyId: settings.accessKeyId,
        secretAccessKey: settings.secretAccessKey,
      },
      // MinIO serves buckets as a path segment rather than a subdomain, and R2
      // accepts the same form. Without this the SDK builds a host that neither
      // resolves locally nor matches R2's certificate.
      forcePathStyle: true,
    }),
  };
}

export function objectKey(boardId: string, attachmentId: string): string {
  return `boards/${boardId}/${attachmentId}`;
}

export async function presignPut(key: string, contentType: string): Promise<string> {
  const { s3, bucket } = client();
  return getSignedUrl(
    s3,
    new PutObjectCommand({ Bucket: bucket, Key: key, ContentType: contentType }),
    { expiresIn: SIGNED_URL_TTL_SECONDS },
  );
}

// The signing timestamp is rounded down to a five-minute window so repeat
// renders of the same inline image produce the *same* URL and the browser's own
// cache answers them. A fresh signature per request would make every render a
// cache miss and another billable Class B operation. Caching the 302 instead
// would stretch revocation from seconds to minutes, which is the property this
// route exists to provide — so the stability goes here, not in a header.
//
// `signingDate` is NOT confirmed to exist on this SDK's presigner options —
// Step 6 proves or disproves it. If it does not type-check or does not produce
// a stable URL, delete this option and the SIGNING_WINDOW_MS constant; the
// feature is correct without it, only chattier. Do not keep an option that
// silently does nothing.
export async function presignGet(
  key: string,
  filename: string,
  inline: boolean,
): Promise<string> {
  const { s3, bucket } = client();
  const disposition = inline ? 'inline' : 'attachment';
  return getSignedUrl(
    s3,
    new GetObjectCommand({
      Bucket: bucket,
      Key: key,
      ResponseContentDisposition: `${disposition}; filename="${filename.replace(/"/g, '')}"`,
    }),
    {
      expiresIn: SIGNED_URL_TTL_SECONDS,
      signingDate: new Date(Math.floor(Date.now() / SIGNING_WINDOW_MS) * SIGNING_WINDOW_MS),
    },
  );
}

export async function headObject(
  key: string,
): Promise<{ size: number; contentType: string } | null> {
  const { s3, bucket } = client();
  try {
    const head = await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    return {
      size: head.ContentLength ?? 0,
      contentType: head.ContentType ?? 'application/octet-stream',
    };
  } catch (error) {
    if (
      typeof error === 'object' &&
      error !== null &&
      '$metadata' in error &&
      (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode === 404
    ) {
      return null;
    }
    throw error;
  }
}

// Best effort by design, and it lives HERE rather than in lib/actions: every
// export of a 'use server' module becomes a callable endpoint, so exporting a
// "delete these keys" helper from there would hand the browser an unauthorised
// object-delete API. Nothing in this module is reachable from a client.
export async function forgetObjects(keys: string[]): Promise<void> {
  try {
    await deleteObjects(keys);
  } catch (error) {
    console.error('attachment objects left behind', { keys, error });
  }
}

export async function deleteObjects(keys: string[]): Promise<void> {
  if (keys.length === 0) return;
  const { s3, bucket } = client();
  // DeleteObjects takes up to 1000 keys per call, which is why a board-wide
  // delete is a handful of requests rather than one per row.
  for (let i = 0; i < keys.length; i += 1000) {
    await s3.send(
      new DeleteObjectsCommand({
        Bucket: bucket,
        Delete: { Objects: keys.slice(i, i + 1000).map((Key) => ({ Key })) },
      }),
    );
  }
}
```

- [x] **Step 5: Run the test and watch it pass**

MinIO must be up: `docker compose up -d minio minio-init`.

**`vitest.config.ts` sets no `env` and no `setupFiles`, and dotenv is not a
dependency — so `.env.local` is invisible to `pnpm test`.** Export the five
variables for this run rather than adding a dotenv dependency; CI gets them from
the workflow's own `env:` block, which is why the in-file `CI` assertion is what
stops this becoming a silent skip.

```bash
S3_ENDPOINT=http://localhost:9000 S3_REGION=us-east-1 S3_BUCKET=kanban-attachments \
S3_ACCESS_KEY_ID=kanban S3_SECRET_ACCESS_KEY=kanban-local-only \
pnpm exec vitest run lib/storage.test.ts > /tmp/a4.log 2>&1; echo "EXIT=$?"; tail -20 /tmp/a4.log
```

Expected: PASS, 8 tests, none skipped. If the round-trip block reports as skipped, the variables did not reach the run — fix that rather than moving on, because a skipped suite reports as a pass.

- [x] **Step 6: Prove or disprove the stable-URL optimisation**

**This step exists because `signingDate` is an unverified API.** The AWS SDK's
own presigner documentation lists `expiresIn`, `signableHeaders` and
`unhoistableHeaders`; it does not mention `signingDate`. It may well exist on
`RequestPresigningArguments` — do not assume either way, find out.

`tsx` is not a dependency, so this is a test in `lib/storage.test.ts` rather than
a one-off script — which also means the property stays guarded afterwards instead
of being checked once. Add it inside the `describe.skipIf` block:

```ts
  test('two signatures inside one window produce the same URL', async () => {
    // The cost argument rests on this: a fresh URL per render is a browser cache
    // miss and another billable Class B operation. If this cannot be made to
    // pass, delete the optimisation rather than keeping an option that does
    // nothing — see the note in presignGet.
    const [a, b] = await Promise.all([
      presignGet(key, 'x.png', true),
      presignGet(key, 'x.png', true),
    ]);
    expect(a).toBe(b);
  });
```

Run it:

```bash
S3_ENDPOINT=http://localhost:9000 S3_REGION=us-east-1 S3_BUCKET=kanban-attachments \
S3_ACCESS_KEY_ID=kanban S3_SECRET_ACCESS_KEY=kanban-local-only \
pnpm exec vitest run lib/storage.test.ts > /tmp/a4url.log 2>&1; echo "EXIT=$?"; tail -20 /tmp/a4url.log
```

**If it fails, or `pnpm typecheck` rejects the option:** delete `signingDate`,
delete `SIGNING_WINDOW_MS`, delete this test, and delete the paragraph of comment
that explains them. Then record the consequence in `CLAUDE.md` — every inline-image
render costs one Class B operation, against a free tier of 10 million a month, so
it is a note for later rather than a problem now. **Do not** substitute caching the
302: that trades a cost we are not paying for a weakening of revocation.

Either outcome is a success for this step. What is not acceptable is leaving an
option in the code that nobody proved does anything.

- [x] **Step 7: Commit**

```bash
git add lib/storage.ts lib/storage.test.ts package.json pnpm-lock.yaml
git commit -m "feat: add the S3 storage module"
```

---

### Task A5 removed — moved to Section B

`/privacy` naming Cloudflare as a sub-processor does not belong in Section A:
no account or bucket exists, and there is no action or interface yet through
which a user could attach anything, so publishing the change here would name a
sub-processor that processes nothing and assert an EU-residency claim nobody
can verify. The task, its copy and its tests move to Section B as Task B7,
unchanged, where the actions and download route first give Cloudflare
something to receive.

---

### Task A6: Section A documentation

**Files:**
- Modify: `CLAUDE.md`
- Modify: `docs/plans/attachments.md` (tick Section A's boxes)

- [x] **Step 1: Update `CLAUDE.md` "Data model"**

Add `attachments` to the table list with its columns, and add rules covering: the three cascades and why each differs, and the six caps with the free-tier arithmetic behind the two storage totals.

- [x] **Step 2: Update `CLAUDE.md` "Layout"**

Add `lib/storage.ts` and `lib/attachments-limits.ts` to the tree — the two modules Section A actually
ships. `lib/attachments.ts` and `lib/actions/attachments.ts` are Section B's; add them to the tree
when that section lands, not here.

- [x] **Step 3: Update `CLAUDE.md` "Deployment"**

Add the five `S3_*` variables to the env list, the MinIO service to the docker paragraph, and a line recording that R2's EU jurisdiction is reachable on one endpoint only — and that CI starts MinIO as a step because `services:` cannot override a command.

- [x] **Step 4: Run the whole suite before opening the PR**

```bash
pnpm typecheck > /tmp/tc.log 2>&1; echo "TYPECHECK=$?"
pnpm lint > /tmp/lint.log 2>&1; echo "LINT=$?"
pnpm test > /tmp/unit.log 2>&1; echo "TEST=$?"
pnpm build > /tmp/build.log 2>&1; echo "BUILD=$?"
pnpm exec playwright test --reporter=line > /tmp/e2e.log 2>&1; echo "E2E=$?"
tail -3 /tmp/e2e.log
```

All five must be `0`, each read from its own log. `pnpm build` is not optional here: for `lib/permissions.ts`, `lib/events.ts` and `lib/db` it is the check that catches a server-only module reaching the client bundle. `lib/storage.ts` no longer depends on `pnpm build` for that protection — it starts with `import 'server-only';`, so the failure is explicit and immediate rather than riding on `pg`'s Node built-ins having no browser shim.

- [ ] **Step 5: Commit and open the PR**

```bash
git add CLAUDE.md docs/plans/attachments.md
git commit -m "docs: record the attachments schema and storage setup"
git push -u origin feat/attachments-storage
gh pr create --base main --title "feat: attachments Section A — storage foundation" --body "..."
```

The body states which spec and plan section this implements, what was verified with actual observed output, and that the migration must be run against production by hand when this lands.

- [ ] **Step 6: Run the migration against production**

Vercel deploys straight from a push to `main`, so CI cannot gate it. When this PR lands:

```bash
MIGRATE_URL="$(npx --yes neonctl@4 connection-string main --project-id withered-glade-54206401)" pnpm db:migrate
```

Confirm with `\dt`, not with the success line.

---

# Section B — actions and the download route

The three writes, the reads they need, and the one route that serves bytes, plus the legal page — this is the pull request in which Cloudflare first can receive a byte. No UI. Branch `feat/attachments-actions` from `main` once Section A has landed — confirm the base is real first:

```bash
git merge-base --is-ancestor origin/main HEAD && echo "base is real"
```

### Task B1: The reads

**Files:**
- Create: `lib/attachments.ts`
- Test: `lib/attachments.test.ts`

**Interfaces:**
- Consumes: `PENDING_TTL_MINUTES` from `lib/attachments-limits.ts`; `attachments` from `lib/db/schema.ts`.
- Produces, all from `lib/attachments.ts`:
  - `type CardAttachment = { id: string; filename: string; contentType: string; size: number; createdAt: Date; uploader: { id: string; name: string | null; image: string | null } | null }`
  - `cardAttachments(cardId: string): Promise<CardAttachment[]>`
  - `boardUsage(boardId: string, now?: Date): Promise<number>`
  - `uploaderUsage(userId: string, now?: Date): Promise<number>`
  - `pendingCutoff(now?: Date): Date`

- [x] **Step 1: Write the failing test**

Create `lib/attachments.test.ts`. The db mock follows the shape `lib/actions/labels.test.ts` already uses — a hand-rolled object, not a library. What matters here is the *predicate*, so the test drives the `where` callback rather than asserting on SQL strings:

```ts
import { describe, expect, test } from 'vitest';

import { PENDING_TTL_MINUTES } from '@/lib/attachments-limits';
import { pendingCutoff } from '@/lib/attachments';

describe('pendingCutoff', () => {
  test('is PENDING_TTL_MINUTES before the given moment', () => {
    const now = new Date('2026-09-02T12:00:00.000Z');
    expect(pendingCutoff(now).toISOString()).toBe('2026-09-02T11:45:00.000Z');
    expect(PENDING_TTL_MINUTES).toBe(15);
  });

  test('defaults to now', () => {
    const before = Date.now();
    const cutoff = pendingCutoff().getTime();
    expect(cutoff).toBeLessThanOrEqual(before - PENDING_TTL_MINUTES * 60 * 1000 + 5);
  });
});
```

The sums themselves are proved against a real database in Task B2's e2e, because what they must get right — that a stale pending row stops counting — is a `where` clause Postgres evaluates, not arithmetic TypeScript does.

- [x] **Step 2: Run the test and watch it fail**

```bash
pnpm exec vitest run lib/attachments.test.ts > /tmp/b1.log 2>&1; echo "EXIT=$?"; tail -20 /tmp/b1.log
```

Expected: FAIL — `Failed to resolve import "@/lib/attachments"`.

- [x] **Step 3: Write the module**

Create `lib/attachments.ts`:

```ts
import { and, eq, gte, or, sql, type SQL } from 'drizzle-orm';

import { PENDING_TTL_MINUTES } from '@/lib/attachments-limits';
import { db } from '@/lib/db';
import { attachments } from '@/lib/db/schema';

export type CardAttachment = {
  id: string;
  filename: string;
  contentType: string;
  size: number;
  createdAt: Date;
  uploader: { id: string; name: string | null; image: string | null } | null;
};

export function pendingCutoff(now: Date = new Date()): Date {
  return new Date(now.getTime() - PENDING_TTL_MINUTES * 60 * 1000);
}

// A row counts against the caps when it is ready, or when it is pending and
// still young enough to believe still in flight. A stale pending row is an
// abandoned upload and must hold neither a slot nor a byte against anybody.
function counted(cutoff: Date): SQL | undefined {
  return or(eq(attachments.status, 'ready'), gte(attachments.createdAt, cutoff));
}

async function sumSize(where: SQL | undefined): Promise<number> {
  const [row] = await db
    // bigint, not int: int4 tops out at 2,147,483,647 and STORAGE_PER_ACCOUNT
    // is 2,147,483,648 — an int cast would overflow at exactly the boundary
    // this sum exists to enforce. node-postgres hands bigint back as a string.
    .select({ total: sql<string>`coalesce(sum(${attachments.size}), 0)::bigint` })
    .from(attachments)
    .where(where);
  return Number(row?.total ?? 0);
}

export async function boardUsage(boardId: string, now: Date = new Date()): Promise<number> {
  return sumSize(and(eq(attachments.boardId, boardId), counted(pendingCutoff(now))));
}

export async function uploaderUsage(userId: string, now: Date = new Date()): Promise<number> {
  return sumSize(and(eq(attachments.uploaderId, userId), counted(pendingCutoff(now))));
}

export async function cardAttachments(cardId: string): Promise<CardAttachment[]> {
  const rows = await db.query.attachments.findMany({
    where: (row, { and: all, eq: is }) => all(is(row.cardId, cardId), is(row.status, 'ready')),
    columns: { id: true, filename: true, contentType: true, size: true, createdAt: true },
    orderBy: (row, { asc }) => [asc(row.createdAt), asc(row.id)],
    with: { uploader: { columns: { id: true, name: true, image: true } } },
  });

  return rows.map((row) => ({
    id: row.id,
    filename: row.filename,
    contentType: row.contentType,
    size: row.size,
    createdAt: row.createdAt,
    uploader: row.uploader ?? null,
  }));
}
```

- [x] **Step 4: Run the test and watch it pass**

```bash
pnpm exec vitest run lib/attachments.test.ts > /tmp/b1.log 2>&1; echo "EXIT=$?"; tail -20 /tmp/b1.log
```

Expected: PASS, 2 tests.

- [x] **Step 5: Commit**

```bash
git add lib/attachments.ts lib/attachments.test.ts
git commit -m "feat: add attachment reads and the usage sums"
```

---

### Task B2: `requestUpload`

**Files:**
- Create: `lib/actions/attachments.ts`
- Test: `lib/actions/attachments.test.ts`
- Test: `e2e/attachments.spec.ts` (create)

**Interfaces:**
- Consumes: `assertBoardAccess`, `boardAccessResult` from `lib/permissions.ts`; `boardIdForCard` from `lib/actions/scope.ts`; `objectKey`, `presignPut`, `deleteObjects`, `storageConfigured` from `lib/storage.ts`; `boardUsage`, `uploaderUsage`, `pendingCutoff` from `lib/attachments.ts`.
- Produces: `requestUpload(input: unknown)` returning `{ ok: true; data: { attachmentId: string; url: string } }` or `{ ok: false; error: 'UNAUTHENTICATED' | 'INVALID' | 'NOT_FOUND' | 'FORBIDDEN' | 'UNAVAILABLE' | 'TOO_MANY' | 'BOARD_FULL' | 'ACCOUNT_FULL' }`.

- [x] **Step 1: Write the failing test**

Add to `lib/actions/attachments.test.ts`, mocking `@/lib/auth`, `@/lib/permissions`, `@/lib/events`, `@/lib/storage` and `@/lib/db` the way `lib/actions/labels.test.ts` does. The assertions that matter are the guard order and the two quota refusals:

```ts
import { beforeEach, describe, expect, test, vi } from 'vitest';

const authMock = vi.fn();
vi.mock('@/lib/auth', () => ({ auth: () => authMock() }));

const assertBoardAccess = vi.fn();
vi.mock('@/lib/permissions', async () => {
  const actual = await vi.importActual<typeof import('@/lib/permissions')>('@/lib/permissions');
  return { ...actual, assertBoardAccess: (...args: unknown[]) => assertBoardAccess(...args) };
});

const presignPut = vi.fn(async () => 'https://bucket.example/put');
const deleteObjects = vi.fn(async () => undefined);
const headObject = vi.fn();
vi.mock('@/lib/storage', async () => {
  const actual = await vi.importActual<typeof import('@/lib/storage')>('@/lib/storage');
  return {
    ...actual,
    storageConfigured: () => true,
    presignPut: (...a: unknown[]) => presignPut(...a),
    deleteObjects: (...a: unknown[]) => deleteObjects(...a),
    headObject: (...a: unknown[]) => headObject(...a),
  };
});

let boardTotal = 0;
let accountTotal = 0;
let cardCount = 0;
vi.mock('@/lib/attachments', async () => {
  const actual = await vi.importActual<typeof import('@/lib/attachments')>('@/lib/attachments');
  return {
    ...actual,
    boardUsage: async () => boardTotal,
    uploaderUsage: async () => accountTotal,
  };
});

// The db mock follows lib/actions/labels.test.ts: a hand-rolled object that
// records the operations, so a test can assert what was written and in what
// order rather than mocking the ORM's fluent chain blindly.
// ...db mock omitted here only because it is identical in shape to that file's;
// copy it, adding `attachments` to `query` with a findMany that returns
// `cardRows` and a findFirst that returns `attachmentRow`.

import { requestUpload } from '@/lib/actions/attachments';

beforeEach(() => {
  authMock.mockResolvedValue({ user: { id: 'u1' } });
  assertBoardAccess.mockResolvedValue('member');
  boardTotal = 0;
  accountTotal = 0;
  cardCount = 0;
  presignPut.mockClear();
  deleteObjects.mockClear();
});

const valid = {
  cardId: 'c1',
  filename: 'screenshot.png',
  contentType: 'image/png',
  size: 1024,
  mutationId: crypto.randomUUID(),
};

describe('requestUpload', () => {
  test('refuses a signed-out caller before it looks at anything else', async () => {
    authMock.mockResolvedValue(null);
    expect(await requestUpload(valid)).toEqual({ ok: false, error: 'UNAUTHENTICATED' });
    expect(assertBoardAccess).not.toHaveBeenCalled();
  });

  test('requires member, not viewer', async () => {
    // A viewer can comment but cannot write billable bytes.
    await requestUpload(valid);
    expect(assertBoardAccess).toHaveBeenCalledWith('u1', 'b1', 'member');
  });

  test('refuses a filename over the cap', async () => {
    const result = await requestUpload({ ...valid, filename: 'a'.repeat(201) });
    expect(result).toEqual({ ok: false, error: 'INVALID' });
  });

  test('refuses when the board is already full', async () => {
    boardTotal = 1024 * 1024 * 1024;
    expect(await requestUpload(valid)).toEqual({ ok: false, error: 'BOARD_FULL' });
    expect(presignPut).not.toHaveBeenCalled();
  });

  test('refuses when the declared size would push the board over', async () => {
    boardTotal = 1024 * 1024 * 1024 - 512;
    expect(await requestUpload({ ...valid, size: 1024 })).toEqual({
      ok: false,
      error: 'BOARD_FULL',
    });
  });

  test('refuses when the uploader is at their own cap', async () => {
    accountTotal = 2 * 1024 * 1024 * 1024;
    expect(await requestUpload(valid)).toEqual({ ok: false, error: 'ACCOUNT_FULL' });
  });

  test('refuses an eleventh attachment on one card', async () => {
    cardCount = 10;
    expect(await requestUpload(valid)).toEqual({ ok: false, error: 'TOO_MANY' });
  });

  test('reports UNAVAILABLE rather than crashing when no bucket is configured', async () => {
    // A self-hoster with no S3_* variables must get a clean refusal, because
    // the UI is hidden and only a stale page could still call this.
    vi.mocked(await import('@/lib/storage')).storageConfigured = () => false;
    expect(await requestUpload(valid)).toEqual({ ok: false, error: 'UNAVAILABLE' });
  });

  test('returns a presigned URL and an id on success', async () => {
    const result = await requestUpload(valid);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.url).toBe('https://bucket.example/put');
      expect(result.data.attachmentId).toEqual(expect.any(String));
    }
  });

  test('publishes nothing — a pending row is not news', async () => {
    // The board only learns about an attachment once confirmUpload has
    // verified it. Publishing here would show every other client a file that
    // may never finish uploading.
    await requestUpload(valid);
    expect(publish).not.toHaveBeenCalled();
  });
});
```

- [x] **Step 2: Run the test and watch it fail**

```bash
pnpm exec vitest run lib/actions/attachments.test.ts > /tmp/b2.log 2>&1; echo "EXIT=$?"; tail -20 /tmp/b2.log
```

Expected: FAIL — `Failed to resolve import "@/lib/actions/attachments"`.

- [x] **Step 3: Write the action**

Create `lib/actions/attachments.ts`:

```ts
'use server';

import { and, eq, lt } from 'drizzle-orm';
import { z } from 'zod';

import { boardUsage, pendingCutoff, uploaderUsage } from '@/lib/attachments';
import {
  ATTACHMENTS_PER_CARD,
  ATTACHMENT_SIZE_MAX,
  FILENAME_MAX,
  STORAGE_PER_ACCOUNT,
  STORAGE_PER_BOARD,
} from '@/lib/attachments-limits';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { attachments } from '@/lib/db/schema';
import { assertBoardAccess, boardAccessResult } from '@/lib/permissions';
import {
  forgetObjects,
  headObject,
  objectKey,
  presignPut,
  storageConfigured,
} from '@/lib/storage';
import { boardIdForCard } from './scope';

const id = z.string().min(1);
const mutationId = z.uuid();

const requestSchema = z.object({
  cardId: id,
  filename: z.string().trim().min(1).max(FILENAME_MAX),
  contentType: z.string().min(1).max(255),
  // The client's claim, used only to reserve space. confirmUpload replaces it
  // with what headObject actually read back.
  size: z.number().int().positive().max(ATTACHMENT_SIZE_MAX),
  mutationId,
});

// Deletes this card's abandoned uploads and their objects. Vercel rules out a
// scheduled sweeper, so this runs on the write path — the same read-time
// expiry board_invites already uses, moved to where the slot is contested.
async function sweepStalePending(cardId: string): Promise<void> {
  const stale = await db
    .select({ id: attachments.id, key: attachments.key })
    .from(attachments)
    .where(
      and(
        eq(attachments.cardId, cardId),
        eq(attachments.status, 'pending'),
        lt(attachments.createdAt, pendingCutoff()),
      ),
    );
  if (stale.length === 0) return;

  await db.delete(attachments).where(
    and(eq(attachments.cardId, cardId), eq(attachments.status, 'pending'),
        lt(attachments.createdAt, pendingCutoff())),
  );
  await forgetObjects(stale.map((row) => row.key));
}

export async function requestUpload(input: unknown) {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: 'UNAUTHENTICATED' } as const;

  const parsed = requestSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'INVALID' } as const;

  if (!storageConfigured()) return { ok: false, error: 'UNAVAILABLE' } as const;

  const { cardId, filename, contentType, size } = parsed.data;

  const boardId = await boardIdForCard(cardId);
  if (!boardId) return { ok: false, error: 'NOT_FOUND' } as const;

  try {
    await assertBoardAccess(session.user.id, boardId, 'member');
  } catch (error) {
    return boardAccessResult(error);
  }

  await sweepStalePending(cardId);

  // Guards, not invariants: two simultaneous requests can both read the same
  // total. Admitting one extra file costs a few megabytes, and the
  // alternatives are a lock or a constraint that neither limit is worth.
  const onCard = await db.query.attachments.findMany({
    where: (row, { and: all, eq: is }) => all(is(row.cardId, cardId)),
    columns: { id: true },
  });
  if (onCard.length >= ATTACHMENTS_PER_CARD) {
    return { ok: false, error: 'TOO_MANY' } as const;
  }

  if ((await boardUsage(boardId)) + size > STORAGE_PER_BOARD) {
    return { ok: false, error: 'BOARD_FULL' } as const;
  }
  if ((await uploaderUsage(session.user.id)) + size > STORAGE_PER_ACCOUNT) {
    return { ok: false, error: 'ACCOUNT_FULL' } as const;
  }

  const attachmentId = crypto.randomUUID();
  const key = objectKey(boardId, attachmentId);

  await db.insert(attachments).values({
    id: attachmentId,
    boardId,
    cardId,
    uploaderId: session.user.id,
    key,
    filename,
    contentType,
    size,
    status: 'pending',
  });

  return {
    ok: true,
    data: { attachmentId, url: await presignPut(key, contentType) },
  } as const;
}
```

- [x] **Step 4: Run the test and watch it pass**

```bash
pnpm exec vitest run lib/actions/attachments.test.ts > /tmp/b2.log 2>&1; echo "EXIT=$?"; tail -20 /tmp/b2.log
```

Expected: PASS, 10 tests.

- [x] **Step 5: Prove the sweep against a real database**

The stale-pending predicate is a `where` clause Postgres evaluates, so a mock cannot prove it. Create `e2e/attachments.spec.ts`:

```ts
import { expect, test } from '@playwright/test';
import { Pool } from 'pg';
import {
  boardColumns,
  closeSeedPool,
  removeSeededUser,
  seedBoard,
  seedCard,
  seedSession,
} from './support/session';

test.afterAll(async () => {
  await closeSeedPool();
});

test('a stale pending row stops counting, a fresh one still does', async ({ context }) => {
  const { userId } = await seedSession(context);
  const boardId = await seedBoard(userId, 'Usage sums');
  const [first] = await boardColumns(boardId);
  const cardId = await seedCard(first.id, { boardId, createdById: userId });

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const insert = (id: string, status: string, minutesAgo: number, size: number) =>
      pool.query(
        `insert into attachments
           (id, board_id, card_id, uploader_id, key, filename, content_type, size, status, created_at)
         values ($1,$2,$3,$4,$5,'f.bin','application/octet-stream',$6,$7, now() - ($8 || ' minutes')::interval)`,
        [id, boardId, cardId, userId, `boards/${boardId}/${id}`, size, status, String(minutesAgo)],
      );

    await insert('att-ready', 'ready', 120, 1000);
    await insert('att-fresh', 'pending', 1, 200);
    await insert('att-stale', 'pending', 60, 900_000);

    const { rows } = await pool.query<{ total: string }>(
      `select coalesce(sum(size),0)::bigint as total from attachments
        where board_id = $1 and (status = 'ready' or created_at >= now() - interval '15 minutes')`,
      [boardId],
    );
    // ready + fresh pending, and emphatically not the stale one.
    expect(Number(rows[0].total)).toBe(1200);
  } finally {
    await pool.end();
    await removeSeededUser(userId);
  }
});
```

```bash
pnpm exec playwright test e2e/attachments.spec.ts --reporter=line > /tmp/b2e2e.log 2>&1; echo "EXIT=$?"; tail -5 /tmp/b2e2e.log
```

Expected: PASS.

- [x] **Step 6: Commit**

```bash
git add lib/actions/attachments.ts lib/actions/attachments.test.ts e2e/attachments.spec.ts
git commit -m "feat: add requestUpload with the per-card and storage caps"
```

---

### Task B3: `confirmUpload` — where the caps become real

**Files:**
- Modify: `lib/actions/attachments.ts`
- Modify: `lib/actions/attachments.test.ts`

**Interfaces:**
- Consumes: `headObject`, `forgetObjects` from `lib/storage.ts`; `publish` from `lib/events.ts`.
- Produces: `confirmUpload(input: unknown)` returning `{ ok: true; data: { attachmentId: string } }` or `{ ok: false; error: 'UNAUTHENTICATED' | 'INVALID' | 'NOT_FOUND' | 'FORBIDDEN' | 'TOO_LARGE' | 'BOARD_FULL' | 'ACCOUNT_FULL' }`.

**This is the most important task in the plan.** Everything before it takes the client's word. The `size` and `contentType` written by `requestUpload` are claims; the ones written here are facts read back from the bucket. A reviewer should reject this task if any code path lets a claimed value survive into a `ready` row.

Section D adds the `publish` call. Until then this action writes the row and returns; leave a comment saying so rather than inventing an event name early.

- [x] **Step 1: Write the failing test**

Add to `lib/actions/attachments.test.ts`:

```ts
import { confirmUpload } from '@/lib/actions/attachments';

describe('confirmUpload', () => {
  beforeEach(() => {
    attachmentRow = {
      id: 'a1',
      boardId: 'b1',
      cardId: 'c1',
      uploaderId: 'u1',
      key: 'boards/b1/a1',
      filename: 'screenshot.png',
      contentType: 'image/png',
      size: 1024,
      status: 'pending',
    };
    headObject.mockResolvedValue({ size: 1024, contentType: 'image/png' });
  });

  test('refuses when the object never landed', async () => {
    headObject.mockResolvedValue(null);
    expect(await confirmUpload({ attachmentId: 'a1', mutationId: crypto.randomUUID() })).toEqual({
      ok: false,
      error: 'NOT_FOUND',
    });
  });

  test('stores the real size, not the declared one', async () => {
    // The row claimed 1024. The bucket says 4096. The row must end up saying
    // 4096 — otherwise every quota downstream is computed from a client's word.
    headObject.mockResolvedValue({ size: 4096, contentType: 'image/png' });
    await confirmUpload({ attachmentId: 'a1', mutationId: crypto.randomUUID() });
    const update = ops.find((op) => op.kind === 'update' && op.table === 'attachments');
    expect(update?.values).toMatchObject({ size: 4096, status: 'ready' });
  });

  test('stores the real content type, not the declared one', async () => {
    // A file declared image/png that is actually text/html must not be
    // remembered as an image — the inline allowlist reads this column.
    headObject.mockResolvedValue({ size: 1024, contentType: 'text/html' });
    await confirmUpload({ attachmentId: 'a1', mutationId: crypto.randomUUID() });
    const update = ops.find((op) => op.kind === 'update' && op.table === 'attachments');
    expect(update?.values).toMatchObject({ contentType: 'text/html' });
  });

  test('rejects an object larger than the per-file cap and deletes it', async () => {
    headObject.mockResolvedValue({ size: 20 * 1024 * 1024, contentType: 'image/png' });
    expect(await confirmUpload({ attachmentId: 'a1', mutationId: crypto.randomUUID() })).toEqual({
      ok: false,
      error: 'TOO_LARGE',
    });
    expect(deleteObjects).toHaveBeenCalledWith(['boards/b1/a1']);
    expect(ops.some((op) => op.kind === 'delete' && op.table === 'attachments')).toBe(true);
  });

  test('rejects an object whose declared size fitted the board quota but whose real size does not', async () => {
    // The whole reason the quota is checked twice. requestUpload reserved
    // against 1024; the bucket holds something far larger.
    boardTotal = 1024 * 1024 * 1024 - 2048;
    headObject.mockResolvedValue({ size: 8 * 1024 * 1024, contentType: 'image/png' });
    expect(await confirmUpload({ attachmentId: 'a1', mutationId: crypto.randomUUID() })).toEqual({
      ok: false,
      error: 'BOARD_FULL',
    });
    expect(deleteObjects).toHaveBeenCalledWith(['boards/b1/a1']);
  });

  test('refuses to confirm somebody else’s pending row', async () => {
    attachmentRow = { ...attachmentRow, uploaderId: 'someone-else' };
    expect(await confirmUpload({ attachmentId: 'a1', mutationId: crypto.randomUUID() })).toEqual({
      ok: false,
      error: 'NOT_FOUND',
    });
  });

  test('refuses to confirm a row that is already ready', async () => {
    attachmentRow = { ...attachmentRow, status: 'ready' };
    expect(await confirmUpload({ attachmentId: 'a1', mutationId: crypto.randomUUID() })).toEqual({
      ok: false,
      error: 'NOT_FOUND',
    });
  });

  test('checks board access before it touches the bucket', async () => {
    assertBoardAccess.mockRejectedValue(new BoardAccessError('FORBIDDEN'));
    expect(await confirmUpload({ attachmentId: 'a1', mutationId: crypto.randomUUID() })).toEqual({
      ok: false,
      error: 'FORBIDDEN',
    });
    expect(headObject).not.toHaveBeenCalled();
  });
});
```

- [x] **Step 2: Run the test and watch it fail**

```bash
pnpm exec vitest run lib/actions/attachments.test.ts -t confirmUpload > /tmp/b3.log 2>&1; echo "EXIT=$?"; tail -20 /tmp/b3.log
```

Expected: FAIL — `confirmUpload is not a function`.

- [x] **Step 3: Write the action**

Append to `lib/actions/attachments.ts`:

```ts
const confirmSchema = z.object({ attachmentId: id, mutationId });

export async function confirmUpload(input: unknown) {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: 'UNAUTHENTICATED' } as const;

  const parsed = confirmSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'INVALID' } as const;

  const row = await db.query.attachments.findFirst({
    where: (a, { eq: is }) => is(a.id, parsed.data.attachmentId),
    columns: {
      id: true, boardId: true, cardId: true, uploaderId: true,
      key: true, filename: true, status: true,
    },
  });
  // Somebody else's row, or one already confirmed, answers the same as a row
  // that never existed: a guessed id learns nothing either way.
  if (!row || row.status !== 'pending' || row.uploaderId !== session.user.id) {
    return { ok: false, error: 'NOT_FOUND' } as const;
  }

  try {
    await assertBoardAccess(session.user.id, row.boardId, 'member');
  } catch (error) {
    return boardAccessResult(error);
  }

  const head = await headObject(row.key);
  if (!head) {
    // The upload never landed. Drop the reservation so it stops holding a slot.
    await db.delete(attachments).where(eq(attachments.id, row.id));
    return { ok: false, error: 'NOT_FOUND' } as const;
  }

  // Everything from here uses head.size and head.contentType. The values the
  // client declared at requestUpload are not consulted again.
  const reject = async (error: 'TOO_LARGE' | 'BOARD_FULL' | 'ACCOUNT_FULL') => {
    await db.delete(attachments).where(eq(attachments.id, row.id));
    await forgetObjects([row.key]);
    return { ok: false, error } as const;
  };

  if (head.size > ATTACHMENT_SIZE_MAX) return reject('TOO_LARGE');

  // Both sums still include this row's own pending reservation, so subtract it
  // before comparing — otherwise a file is measured against itself.
  const [board, account] = await Promise.all([
    boardUsage(row.boardId),
    uploaderUsage(session.user.id),
  ]);
  if (board - row.size + head.size > STORAGE_PER_BOARD) return reject('BOARD_FULL');
  if (account - row.size + head.size > STORAGE_PER_ACCOUNT) return reject('ACCOUNT_FULL');

  await db
    .update(attachments)
    .set({ size: head.size, contentType: head.contentType, status: 'ready' })
    .where(eq(attachments.id, row.id));

  // Section D publishes attachment.added here, after this write has committed.

  return { ok: true, data: { attachmentId: row.id } } as const;
}
```

**Note for the implementer:** `row.size` must be selected for the subtraction above to work — add `size: true` to the `columns` block if you removed it.

- [x] **Step 4: Run the test and watch it pass**

```bash
pnpm exec vitest run lib/actions/attachments.test.ts > /tmp/b3.log 2>&1; echo "EXIT=$?"; tail -20 /tmp/b3.log
```

Expected: PASS, all `requestUpload` and `confirmUpload` tests.

- [x] **Step 5: Commit**

```bash
git add lib/actions/attachments.ts lib/actions/attachments.test.ts
git commit -m "feat: verify the real size and type before an attachment is visible"
```

---

### Task B4: `deleteAttachment`

**Files:**
- Modify: `lib/actions/attachments.ts`
- Modify: `lib/actions/attachments.test.ts`

**Interfaces:**
- Produces: `deleteAttachment(input: unknown)` returning `{ ok: true }` or `{ ok: false; error: 'UNAUTHENTICATED' | 'INVALID' | 'NOT_FOUND' | 'FORBIDDEN' }`.

The permission here is the one place attachments deliberately differ from comments: the **uploader or the board owner**, because the owner pays for the bytes and must be able to clear a file left by somebody whose account is gone.

- [x] **Step 1: Write the failing test**

```ts
import { deleteAttachment } from '@/lib/actions/attachments';

describe('deleteAttachment', () => {
  beforeEach(() => {
    attachmentRow = {
      id: 'a1', boardId: 'b1', cardId: 'c1', uploaderId: 'u1',
      key: 'boards/b1/a1', filename: 'x.png', contentType: 'image/png',
      size: 1024, status: 'ready',
    };
  });

  test('the uploader can delete their own file', async () => {
    assertBoardAccess.mockResolvedValue('member');
    expect(await deleteAttachment({ attachmentId: 'a1', mutationId: crypto.randomUUID() })).toEqual({
      ok: true,
    });
    expect(deleteObjects).toHaveBeenCalledWith(['boards/b1/a1']);
  });

  test('the board owner can delete somebody else’s file', async () => {
    // Deliberately unlike comments, where not even the owner may delete.
    attachmentRow = { ...attachmentRow, uploaderId: 'someone-else' };
    assertBoardAccess.mockResolvedValue('owner');
    expect(await deleteAttachment({ attachmentId: 'a1', mutationId: crypto.randomUUID() })).toEqual({
      ok: true,
    });
  });

  test('the board owner can delete a file whose uploader is gone', async () => {
    attachmentRow = { ...attachmentRow, uploaderId: null };
    assertBoardAccess.mockResolvedValue('owner');
    expect(await deleteAttachment({ attachmentId: 'a1', mutationId: crypto.randomUUID() })).toEqual({
      ok: true,
    });
  });

  test('a plain member cannot delete somebody else’s file', async () => {
    attachmentRow = { ...attachmentRow, uploaderId: 'someone-else' };
    assertBoardAccess.mockResolvedValue('member');
    expect(await deleteAttachment({ attachmentId: 'a1', mutationId: crypto.randomUUID() })).toEqual({
      ok: false,
      error: 'FORBIDDEN',
    });
    expect(deleteObjects).not.toHaveBeenCalled();
  });

  test('the row is deleted before the object', async () => {
    // Publish-after-commit's sibling rule: the durable write settles first, so
    // a failed bucket call cannot leave a row pointing at nothing.
    await deleteAttachment({ attachmentId: 'a1', mutationId: crypto.randomUUID() });
    const rowDeleted = ops.findIndex((op) => op.kind === 'delete' && op.table === 'attachments');
    expect(rowDeleted).toBeGreaterThanOrEqual(0);
    expect(deleteObjects).toHaveBeenCalled();
  });

  test('a bucket failure does not fail the action', async () => {
    // The row is already gone. A leaked object is cheaper than an error the
    // user cannot act on.
    deleteObjects.mockRejectedValueOnce(new Error('bucket unreachable'));
    expect(await deleteAttachment({ attachmentId: 'a1', mutationId: crypto.randomUUID() })).toEqual({
      ok: true,
    });
  });
});
```

- [x] **Step 2: Run the test and watch it fail**

```bash
pnpm exec vitest run lib/actions/attachments.test.ts -t deleteAttachment > /tmp/b4.log 2>&1; echo "EXIT=$?"; tail -20 /tmp/b4.log
```

Expected: FAIL — `deleteAttachment is not a function`.

- [x] **Step 3: Write the action**

```ts
const deleteSchema = z.object({ attachmentId: id, mutationId });

export async function deleteAttachment(input: unknown) {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: 'UNAUTHENTICATED' } as const;

  const parsed = deleteSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'INVALID' } as const;

  const row = await db.query.attachments.findFirst({
    where: (a, { eq: is }) => is(a.id, parsed.data.attachmentId),
    columns: { id: true, boardId: true, cardId: true, uploaderId: true, key: true },
  });
  if (!row) return { ok: false, error: 'NOT_FOUND' } as const;

  let role;
  try {
    role = await assertBoardAccess(session.user.id, row.boardId, 'member');
  } catch (error) {
    return boardAccessResult(error);
  }

  // The uploader, or the owner. Unlike a comment — where not even the owner
  // may delete — because the owner is accountable for the bytes on their board
  // and needs a way to clear a file whose uploader is gone.
  const mine = row.uploaderId === session.user.id;
  if (!mine && role !== 'owner') return { ok: false, error: 'FORBIDDEN' } as const;

  await db.delete(attachments).where(eq(attachments.id, row.id));
  await forgetObjects([row.key]);

  // Section D publishes attachment.removed here.

  return { ok: true } as const;
}
```

- [x] **Step 4: Run the test and watch it pass**

```bash
pnpm exec vitest run lib/actions/attachments.test.ts > /tmp/b4.log 2>&1; echo "EXIT=$?"; tail -20 /tmp/b4.log
```

Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add lib/actions/attachments.ts lib/actions/attachments.test.ts
git commit -m "feat: let the uploader or the board owner delete an attachment"
```

---

### Task B5: The download route

**Files:**
- Create: `app/api/attachments/[attachmentId]/route.ts`
- Test: `app/api/attachments/[attachmentId]/route.test.ts`

**Interfaces:**
- Consumes: `rendersInline` from `lib/attachments-limits.ts`; `presignGet` from `lib/storage.ts`; `assertBoardAccess`.
- Produces: `GET(request: Request, context: { params: Promise<{ attachmentId: string }> }): Promise<Response>` — a 302 to a presigned GET, or 404.

Next 16 hands route params as a **Promise**; `await context.params` rather than destructuring it directly.

- [x] **Step 1: Write the failing test**

```tsx
import { describe, expect, test, vi } from 'vitest';

// mocks as in the action tests: auth, permissions, db, storage
import { GET } from '@/app/api/attachments/[attachmentId]/route';

const call = (attachmentId: string) =>
  GET(new Request('http://localhost/api/attachments/' + attachmentId), {
    params: Promise.resolve({ attachmentId }),
  });

describe('the attachment download route', () => {
  test('404s for a signed-out caller', async () => {
    authMock.mockResolvedValue(null);
    expect((await call('a1')).status).toBe(404);
  });

  test('404s for somebody who is not on the board', async () => {
    // Not 403: a 403 would confirm a guessed id is real, which is the same
    // reasoning assertBoardAccess already follows.
    assertBoardAccess.mockRejectedValue(new BoardAccessError('NOT_FOUND'));
    expect((await call('a1')).status).toBe(404);
  });

  test('a viewer may read — seeing the card is seeing its files', async () => {
    assertBoardAccess.mockResolvedValue('viewer');
    expect((await call('a1')).status).toBe(302);
    expect(assertBoardAccess).toHaveBeenCalledWith('u1', 'b1', 'viewer');
  });

  test('redirects to the presigned URL', async () => {
    const response = await call('a1');
    expect(response.headers.get('location')).toBe('https://bucket.example/get');
  });

  test('renders a PNG inline', async () => {
    attachmentRow = { ...attachmentRow, contentType: 'image/png' };
    await call('a1');
    expect(presignGet).toHaveBeenCalledWith('boards/b1/a1', 'x.png', true);
  });

  test('forces an SVG to download', async () => {
    // An SVG opened in a tab executes script. This is the assertion that keeps
    // it a download forever.
    attachmentRow = { ...attachmentRow, contentType: 'image/svg+xml', filename: 'x.svg' };
    await call('a1');
    expect(presignGet).toHaveBeenCalledWith('boards/b1/a1', 'x.svg', false);
  });

  test('forces a PDF to download', async () => {
    attachmentRow = { ...attachmentRow, contentType: 'application/pdf', filename: 'x.pdf' };
    await call('a1');
    expect(presignGet).toHaveBeenCalledWith('boards/b1/a1', 'x.pdf', false);
  });

  test('never caches the redirect itself', async () => {
    // Caching the 302 would stretch revocation from seconds to minutes. The
    // stability that saves operations lives in presignGet's signing window.
    const response = await call('a1');
    expect(response.headers.get('cache-control')).toContain('no-store');
  });
});
```

- [x] **Step 2: Run the test and watch it fail**

```bash
pnpm exec vitest run "app/api/attachments" > /tmp/b5.log 2>&1; echo "EXIT=$?"; tail -20 /tmp/b5.log
```

Expected: FAIL — module not found.

- [x] **Step 3: Write the route**

```ts
import { rendersInline } from '@/lib/attachments-limits';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { assertBoardAccess } from '@/lib/permissions';
import { presignGet } from '@/lib/storage';

// Everything that goes wrong answers 404, including "you may not". A 403 would
// confirm a guessed id names a real file.
const notFound = () => new Response('Not found', { status: 404 });

export async function GET(
  _request: Request,
  context: { params: Promise<{ attachmentId: string }> },
) {
  const session = await auth();
  if (!session?.user?.id) return notFound();

  const { attachmentId } = await context.params;

  const row = await db.query.attachments.findFirst({
    where: (a, { and, eq }) => and(eq(a.id, attachmentId), eq(a.status, 'ready')),
    columns: { boardId: true, key: true, filename: true, contentType: true },
  });
  if (!row) return notFound();

  try {
    // A viewer may read: seeing the card is seeing its files. The check runs on
    // every request, so a removed member's next request fails — which is why
    // this route exists instead of handing out presigned URLs directly.
    await assertBoardAccess(session.user.id, row.boardId, 'viewer');
  } catch {
    return notFound();
  }

  const url = await presignGet(row.key, row.filename, rendersInline(row.contentType));

  return new Response(null, {
    status: 302,
    headers: {
      location: url,
      // Never cache the redirect: that would extend revocation from seconds to
      // minutes. presignGet's signing window is what saves the operations.
      'cache-control': 'private, no-store',
    },
  });
}
```

- [x] **Step 4: Run the test and watch it pass**

```bash
pnpm exec vitest run "app/api/attachments" > /tmp/b5.log 2>&1; echo "EXIT=$?"; tail -20 /tmp/b5.log
```

Expected: PASS, 8 tests.

- [x] **Step 5: Commit**

```bash
git add app/api/attachments
git commit -m "feat: serve attachments through an access-checked redirect"
```

---

### Task B6: Bytes on cascade

**Files:**
- Modify: `lib/actions/cards.ts` (`deleteCard`)
- Modify: `lib/actions/boards.ts` (`deleteBoard`)
- Modify: `lib/actions/account.ts` (`deleteAccount`)
- Modify: their existing test files

**Interfaces:**
- Consumes: `forgetObjects` from `lib/storage.ts`. **Not** from the actions module: every export of a `'use server'` file is a callable endpoint.

Rows cascade in Postgres; objects in a bucket do not. Each of these three must collect the keys **before** the transaction and delete the objects **after** it commits.

- [ ] **Step 1: Write the failing tests**

Add one test to each of the three existing action test files. In `lib/actions/cards.test.ts`:

```ts
test('deleting a card takes its objects out of the bucket', async () => {
  attachmentKeys = ['boards/b1/a1', 'boards/b1/a2'];
  await deleteCard({ cardId: 'c1', mutationId: crypto.randomUUID() });
  expect(deleteObjects).toHaveBeenCalledWith(['boards/b1/a1', 'boards/b1/a2']);
});

test('the keys are read before the row is deleted', async () => {
  // After the cascade there is nothing left to read them from.
  attachmentKeys = ['boards/b1/a1'];
  await deleteCard({ cardId: 'c1', mutationId: crypto.randomUUID() });
  const keyRead = ops.findIndex((op) => op.kind === 'query' && op.table === 'attachments');
  const rowDeleted = ops.findIndex((op) => op.kind === 'delete' && op.table === 'cards');
  expect(keyRead).toBeGreaterThanOrEqual(0);
  expect(keyRead).toBeLessThan(rowDeleted);
});
```

In `lib/actions/boards.test.ts`, the same pair against `deleteBoard` and `where board_id = ?`. In `lib/actions/account.test.ts`, the same against `deleteAccount`, scoped to every board the departing user owns — and one more, which is the promise `/privacy` makes:

```ts
test('files on other people’s boards are left alone', async () => {
  // The uploader goes null and the file stays. Deleting them would break a
  // colleague's board and contradict the retention section of /privacy.
  ownedBoardIds = ['b-mine'];
  attachmentKeys = ['boards/b-mine/a1'];
  await deleteAccount({ confirm: 'DELETE' });
  expect(deleteObjects).toHaveBeenCalledWith(['boards/b-mine/a1']);
  expect(deleteObjects).not.toHaveBeenCalledWith(expect.arrayContaining(['boards/b-theirs/a9']));
});
```

- [ ] **Step 2: Run the tests and watch them fail**

```bash
pnpm exec vitest run lib/actions/cards.test.ts lib/actions/boards.test.ts lib/actions/account.test.ts > /tmp/b6.log 2>&1; echo "EXIT=$?"; tail -20 /tmp/b6.log
```

Expected: FAIL — `deleteObjects` never called.

- [ ] **Step 3: Wire the three call sites**

In `deleteCard`, before the transaction that deletes the row:

```ts
const keys = await db
  .select({ key: attachments.key })
  .from(attachments)
  .where(eq(attachments.cardId, cardId));
```

and after the transaction commits, beside the existing `publish`:

```ts
await forgetObjects(keys.map((row) => row.key));
```

`deleteBoard` is the same with `eq(attachments.boardId, boardId)`. `deleteAccount` collects across every board the departing user owns — it already resolves that set to decide whether the delete is allowed, so reuse it rather than querying twice, and do **not** widen it to `uploaderId`: those rows keep their file and lose their uploader.

- [ ] **Step 4: Run the tests and watch them pass**

```bash
pnpm exec vitest run lib/actions/cards.test.ts lib/actions/boards.test.ts lib/actions/account.test.ts > /tmp/b6.log 2>&1; echo "EXIT=$?"; tail -20 /tmp/b6.log
```

Expected: PASS.

- [ ] **Step 5: Prove it against a real bucket**

The mocks prove the call is made. Only an end-to-end run proves the object actually leaves. Add to `e2e/attachments.spec.ts` a test that uploads through `requestUpload` + a real `PUT` + `confirmUpload`, deletes the card, and then asserts `headObject` answers null.

- [ ] **Step 6: Commit**

```bash
git add lib/actions e2e/attachments.spec.ts
git commit -m "feat: take a card, board or account's objects out of the bucket with it"
```

---

### Task B7: `/privacy` names the new sub-processor

Moved here from Section A: Section A ships no code that reaches Cloudflare —
no account or bucket exists, and there was no action or interface yet through
which a user could attach anything. Section B is the pull request in which
Cloudflare first can receive a byte, via the actions and the download route
above, so this is where the policy names it. The task, its copy and its tests
are unchanged from the original Section A draft.

**Files:**
- Modify: `app/(legal)/privacy/page.tsx`
- Modify: `app/(legal)/privacy/page.test.tsx`
- Modify: `components/app/delete-account.tsx`

**Interfaces:**
- Consumes: nothing in code. This task exists because `CLAUDE.md` says a claim in the policy and the behaviour of the code must not drift.

- [ ] **Step 1: Write the failing test**

Add to `app/(legal)/privacy/page.test.tsx`, following the shape of the existing region assertion:

```tsx
test('the policy names the attachment store and its region', () => {
  // CLAUDE.md: if a claim in the policy and the behaviour of the code
  // disagree, one of them is the bug. This is the assertion that notices.
  render(<PrivacyPage />);
  expect(screen.getByText('Cloudflare R2')).toBeInTheDocument();
  expect(screen.getByText(/EU — jurisdiction-restricted/)).toBeInTheDocument();
});

test('the policy says files on other people’s boards outlive the account', () => {
  render(<PrivacyPage />);
  expect(screen.getByText(/files you attached to boards owned by other people/i)).toBeInTheDocument();
});
```

- [ ] **Step 2: Run the test and watch it fail**

```bash
pnpm exec vitest run "app/(legal)/privacy/page.test.tsx" > /tmp/b7.log 2>&1; echo "EXIT=$?"; tail -20 /tmp/b7.log
```

Expected: FAIL — unable to find the text.

- [ ] **Step 3: Add the sub-processor row**

In `app/(legal)/privacy/page.tsx`, add to the sub-processor array after the Pusher entry:

```tsx
  ['Cloudflare R2', 'Attachment storage', 'EU — jurisdiction-restricted'],
```

- [ ] **Step 4: Add attachments to what is collected, and to retention**

In the "what is collected" list, extend the sentence covering board content so it reads as one category rather than adding a new bullet for the same thing:

> board, column, card and comment content you create, **and any files you attach to a card — their contents, filename, size and type**

And in retention, after the existing sentence about comments:

> Files you attached to boards owned by other people stay on those boards after
> you delete your account, and stop being linked to you. If you want them
> removed, ask before you delete the account — afterwards nothing connects them
> back to you.

- [ ] **Step 5: Run the test and watch it pass**

```bash
pnpm exec vitest run "app/(legal)/privacy/page.test.tsx" > /tmp/b7.log 2>&1; echo "EXIT=$?"; tail -20 /tmp/b7.log
```

Expected: PASS.

- [ ] **Step 6: Say the same thing in the account danger zone**

`/account`'s danger zone already tells the user that comments on other people's boards survive. Add attachments to that sentence — one clause, not a new paragraph — so the two surfaces cannot drift.

- [ ] **Step 7: Commit**

```bash
git add "app/(legal)/privacy" app/\(app\)/\(chrome\)/account
git commit -m "docs: name the attachment store in the privacy policy"
```

---

### Task B8: Section B verification and pull request

- [ ] **Step 1: Run everything, each exit code from its own log**

```bash
pnpm typecheck > /tmp/tc.log 2>&1; echo "TYPECHECK=$?"
pnpm lint > /tmp/lint.log 2>&1; echo "LINT=$?"
pnpm test > /tmp/unit.log 2>&1; echo "TEST=$?"
pnpm build > /tmp/build.log 2>&1; echo "BUILD=$?"
pnpm exec playwright test --reporter=line > /tmp/e2e.log 2>&1; echo "E2E=$?"
tail -3 /tmp/e2e.log
```

All five `0`. Compare the e2e count that ran against the count collected — a summary line is not an exit code, and a passing count is not a passing suite.

- [ ] **Step 2: Update `CLAUDE.md`**

"Auth and permissions" gains the one-line exception that an attachment, unlike a comment, can be deleted by the board owner, and why. "Layout" gains `app/api/attachments/`.

- [ ] **Step 3: Commit, push, open the PR**

```bash
git add CLAUDE.md docs/plans/attachments.md
git commit -m "docs: record the attachment permission exception"
git push -u origin feat/attachments-actions
gh pr create --base main --title "feat: attachments Section B — actions and downloads" --body "..."
```

---

# Section C — the card modal

The surface. Branch `feat/attachments-modal` from `main` once Section B has landed.

`getCardForRoute(boardId, cardId)` in `lib/cards.ts` already returns `{ card, labels, canWrite, viewer }` and is what both the intercepted modal and the canonical card page call. Attachments join that payload rather than being fetched separately, so the modal and a cold-loaded shared link cannot disagree.

### Task C1: The attachment list

**Files:**
- Create: `components/board/card-attachments.tsx`
- Test: `components/board/card-attachments.test.tsx`
- Modify: `lib/cards.ts`

**Interfaces:**
- Consumes: `CardAttachment` from `lib/attachments.ts` (as `import type` only — that module imports `lib/db`); `rendersInline` from `lib/attachments-limits.ts`.
- Produces: `CardAttachments({ cardId, attachments, canWrite, viewerId, viewerIsOwner, storageEnabled, boardUsed, onChange })`.
- Modifies: `getCardForRoute` also returns `attachments: CardAttachment[]`, `storageEnabled: boolean`, `boardUsed: number`, `viewerIsOwner: boolean`.

- [ ] **Step 1: Write the failing test**

```tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, test } from 'vitest';

import { CardAttachments } from '@/components/board/card-attachments';

const file = (over: Partial<CardAttachment> = {}) => ({
  id: 'a1',
  filename: 'screenshot.png',
  contentType: 'image/png',
  size: 2048,
  createdAt: new Date('2026-09-02T10:00:00Z'),
  uploader: { id: 'u1', name: 'Alex', image: null },
  ...over,
});

const props = {
  cardId: 'c1',
  canWrite: true,
  viewerId: 'u1',
  viewerIsOwner: false,
  storageEnabled: true,
  boardUsed: 0,
  onChange: () => {},
};

describe('CardAttachments', () => {
  test('renders an inline-safe image as an image', () => {
    render(<CardAttachments {...props} attachments={[file()]} />);
    expect(screen.getByRole('img', { name: 'screenshot.png' })).toHaveAttribute(
      'src',
      '/api/attachments/a1',
    );
  });

  test('renders a PDF as a named download, not an image', () => {
    render(
      <CardAttachments
        {...props}
        attachments={[file({ contentType: 'application/pdf', filename: 'spec.pdf' })]}
      />,
    );
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: /spec\.pdf/ })).toHaveAttribute(
      'href',
      '/api/attachments/a1',
    );
  });

  test('never renders an SVG inline', () => {
    render(
      <CardAttachments
        {...props}
        attachments={[file({ contentType: 'image/svg+xml', filename: 'logo.svg' })]}
      />,
    );
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });

  test('shows the size in a mono face', () => {
    render(<CardAttachments {...props} attachments={[file({ size: 2048 })]} />);
    expect(screen.getByText('2 KB')).toBeInTheDocument();
  });

  test('says so when there is nothing attached', () => {
    // An invitation, not an apology — CLAUDE.md's copy rules.
    render(<CardAttachments {...props} attachments={[]} />);
    expect(screen.getByText('Nothing attached yet')).toBeInTheDocument();
  });

  test('offers no upload control to a viewer', () => {
    render(<CardAttachments {...props} canWrite={false} attachments={[file()]} />);
    expect(screen.queryByRole('button', { name: /add file/i })).not.toBeInTheDocument();
  });

  test('offers no upload control when no bucket is configured', () => {
    // The supported self-hosting configuration: a working board, no surface.
    render(<CardAttachments {...props} storageEnabled={false} attachments={[]} />);
    expect(screen.queryByRole('button', { name: /add file/i })).not.toBeInTheDocument();
  });

  test('hides the section entirely when storage is off and nothing is attached', () => {
    render(<CardAttachments {...props} storageEnabled={false} attachments={[]} />);
    expect(screen.queryByText('Attachments')).not.toBeInTheDocument();
  });

  test('shows no usage line below 80% of the board cap', () => {
    render(<CardAttachments {...props} boardUsed={100 * 1024 * 1024} attachments={[file()]} />);
    expect(screen.queryByText(/of 1 GB used/)).not.toBeInTheDocument();
  });

  test('warns once the board passes 80%', () => {
    // A quota is only fair if you can see it coming.
    render(<CardAttachments {...props} boardUsed={900 * 1024 * 1024} attachments={[file()]} />);
    expect(screen.getByText(/of 1 GB used/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test and watch it fail**

```bash
pnpm exec vitest run components/board/card-attachments.test.tsx > /tmp/c1.log 2>&1; echo "EXIT=$?"; tail -20 /tmp/c1.log
```

Expected: FAIL — module not found.

- [ ] **Step 3: Write the component**

Create `components/board/card-attachments.tsx`. Note the `import type` on the first import: `lib/attachments.ts` imports `lib/db`, which builds a pg pool at module scope, and this file is in the client bundle. A value import here passes typecheck, lint and test, and dies only in `pnpm build`.

```tsx
'use client';

import type { CardAttachment } from '@/lib/attachments';
import { STORAGE_PER_BOARD, rendersInline } from '@/lib/attachments-limits';

// Mono, because CLAUDE.md gives data its own family: sizes, dates and counts.
function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const USAGE_WARNING_RATIO = 0.8;

export function CardAttachments({
  attachments,
  canWrite,
  storageEnabled,
  boardUsed,
}: {
  cardId: string;
  attachments: CardAttachment[];
  canWrite: boolean;
  viewerId: string;
  viewerIsOwner: boolean;
  storageEnabled: boolean;
  boardUsed: number;
  onChange: (next: CardAttachment[]) => void;
}) {
  // No bucket and nothing to show: the section does not exist rather than
  // presenting an empty state for a feature this deployment does not have.
  if (!storageEnabled && attachments.length === 0) return null;

  const nearCap = boardUsed >= STORAGE_PER_BOARD * USAGE_WARNING_RATIO;

  return (
    <section>
      <h3 className="text-xs font-semibold uppercase tracking-[0.08em] text-muted">Attachments</h3>

      {attachments.length === 0 ? (
        <p className="text-sm text-muted">Nothing attached yet</p>
      ) : (
        <ul className="mt-2 space-y-3">
          {attachments.map((file) => (
            <li key={file.id}>
              {rendersInline(file.contentType) ? (
                <a href={`/api/attachments/${file.id}`}>
                  {/* Not next/image: the bytes live behind an access-checked
                      redirect, so the optimiser cannot fetch them, and the
                      dimensions are unknown until the image loads. */}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={`/api/attachments/${file.id}`}
                    alt={file.filename}
                    className="max-h-64 rounded-[10px] border border-line"
                  />
                </a>
              ) : (
                <a href={`/api/attachments/${file.id}`} className="text-sm text-ink underline">
                  {file.filename}
                </a>
              )}
              <p className="font-mono text-xs text-muted">{formatSize(file.size)}</p>
            </li>
          ))}
        </ul>
      )}

      {canWrite && storageEnabled && nearCap ? (
        <p className="mt-2 font-mono text-xs text-muted">
          {formatSize(boardUsed)} of 1 GB used
        </p>
      ) : null}
    </section>
  );
}
```

- [ ] **Step 4: Run the test and watch it pass**

```bash
pnpm exec vitest run components/board/card-attachments.test.tsx > /tmp/c1.log 2>&1; echo "EXIT=$?"; tail -20 /tmp/c1.log
```

Expected: PASS, 10 tests. The upload-control tests pass trivially at this point because no control exists yet — Task C2 is what makes them meaningful, and they must keep passing there.

- [ ] **Step 5: Extend `getCardForRoute`**

In `lib/cards.ts`, add `attachments`, `storageEnabled`, `boardUsed` and `viewerIsOwner` to what it returns, using `cardAttachments`, `storageConfigured` and `boardUsage`. Both card routes already destructure this result — extend them rather than fetching separately, so a shared link on a cold load and the intercepted modal cannot disagree.

- [ ] **Step 6: Commit**

```bash
git add components/board/card-attachments.tsx components/board/card-attachments.test.tsx lib/cards.ts
git commit -m "feat: show a card's attachments in the modal"
```

---

### Task C2: Uploading

**Files:**
- Modify: `components/board/card-attachments.tsx`
- Modify: `components/board/card-attachments.test.tsx`

**Interfaces:**
- Consumes: `requestUpload`, `confirmUpload` from `lib/actions/attachments.ts`.

The `PUT` goes through `XMLHttpRequest`, not `fetch`: only XHR reports upload progress, and 10 MB on a bad connection needs a bar.

- [ ] **Step 1: Write the failing test**

```tsx
test('rejects a file over the size cap without calling the server', async () => {
  // The client knows the cap, so a 40 MB file is refused before a round trip.
  const requestUpload = vi.fn();
  render(<CardAttachments {...props} attachments={[]} />);
  await userEvent.upload(
    screen.getByLabelText(/add file/i),
    new File(['x'.repeat(40 * 1024 * 1024)], 'huge.bin'),
  );
  expect(await screen.findByText(/is larger than the 10 MB limit/i)).toBeInTheDocument();
  expect(requestUpload).not.toHaveBeenCalled();
});

test('reports a refusal in the interface’s own voice', async () => {
  requestUpload.mockResolvedValue({ ok: false, error: 'BOARD_FULL' });
  render(<CardAttachments {...props} attachments={[]} />);
  await userEvent.upload(screen.getByLabelText(/add file/i), new File(['x'], 'a.png'));
  // Says what happened and what to do. Never apologises.
  expect(
    await screen.findByText('This board has used its 1 GB of attachment storage. Delete a file to make room.'),
  ).toBeInTheDocument();
});

test('shows progress while the bytes are in flight', async () => {
  render(<CardAttachments {...props} attachments={[]} />);
  await userEvent.upload(screen.getByLabelText(/add file/i), new File(['x'], 'a.png'));
  expect(await screen.findByRole('progressbar')).toBeInTheDocument();
});

test('calls confirmUpload once the PUT has finished', async () => {
  render(<CardAttachments {...props} attachments={[]} />);
  await userEvent.upload(screen.getByLabelText(/add file/i), new File(['x'], 'a.png'));
  await waitFor(() => expect(confirmUpload).toHaveBeenCalledWith(
    expect.objectContaining({ attachmentId: 'new-id' }),
  ));
});

test('does not add the file to the list when confirm rejects it', async () => {
  // A file the server refused at confirm was deleted from the bucket. Showing
  // it would promise something that is not there.
  confirmUpload.mockResolvedValue({ ok: false, error: 'TOO_LARGE' });
  render(<CardAttachments {...props} attachments={[]} />);
  await userEvent.upload(screen.getByLabelText(/add file/i), new File(['x'], 'a.png'));
  await waitFor(() => expect(screen.getByText(/larger than/i)).toBeInTheDocument());
  expect(screen.queryByRole('link', { name: 'a.png' })).not.toBeInTheDocument();
});
```

- [ ] **Step 2: Run and watch it fail**

```bash
pnpm exec vitest run components/board/card-attachments.test.tsx > /tmp/c2.log 2>&1; echo "EXIT=$?"; tail -20 /tmp/c2.log
```

Expected: FAIL — no file input exists.

- [ ] **Step 3: Add the uploader**

Add to `card-attachments.tsx`. The error copy is a lookup, so every refusal reads in the same voice:

```tsx
const REFUSALS: Record<string, string> = {
  BOARD_FULL: 'This board has used its 1 GB of attachment storage. Delete a file to make room.',
  ACCOUNT_FULL: 'You have used your 2 GB of attachment storage. Delete a file to make room.',
  TOO_MANY: 'This card already has ten files. Delete one to add another.',
  TOO_LARGE: 'That file is larger than the 10 MB limit.',
  UNAVAILABLE: 'Attachment storage is not set up for this deployment.',
  FORBIDDEN: 'You do not have permission to attach files to this board.',
  NOT_FOUND: 'That card no longer exists.',
  INVALID: 'That file could not be attached. Check the name and try again.',
  UNAUTHENTICATED: 'Sign in again to attach a file.',
};

function put(url: string, file: File, onProgress: (fraction: number) => void): Promise<void> {
  // XMLHttpRequest, not fetch: fetch reports no upload progress, and 10 MB on
  // a slow connection needs a bar rather than a frozen dialog.
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url);
    xhr.setRequestHeader('content-type', file.type || 'application/octet-stream');
    xhr.upload.addEventListener('progress', (event) => {
      if (event.lengthComputable) onProgress(event.loaded / event.total);
    });
    xhr.addEventListener('load', () =>
      xhr.status >= 200 && xhr.status < 300
        ? resolve()
        : reject(new Error(`upload failed: ${xhr.status}`)),
    );
    xhr.addEventListener('error', () => reject(new Error('upload failed')));
    xhr.send(file);
  });
}
```

The handler: refuse over `ATTACHMENT_SIZE_MAX` locally, call `requestUpload`, `put` with progress, then `confirmUpload`, then `onChange` with the new list. On any failure show `REFUSALS[error]` and drop the pending item — never leave a half-uploaded row on screen.

Add a visible drop target on the section as well as the picker. Both go through the same handler.

- [ ] **Step 4: Run and watch it pass**

```bash
pnpm exec vitest run components/board/card-attachments.test.tsx > /tmp/c2.log 2>&1; echo "EXIT=$?"; tail -20 /tmp/c2.log
```

Expected: PASS, 15 tests — the Task C1 tests asserting that a viewer and an unconfigured deployment get no control must still pass, and now they mean something.

- [ ] **Step 5: Commit**

```bash
git add components/board/card-attachments.tsx components/board/card-attachments.test.tsx
git commit -m "feat: upload an attachment from the card modal"
```

---

### Task C3: Deleting, and slotting the section into the card

**Files:**
- Modify: `components/board/card-attachments.tsx`
- Modify: `components/board/card-attachments.test.tsx`
- Modify: `components/board/card-body.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
test('the uploader sees a delete control on their own file', async () => {
  render(<CardAttachments {...props} viewerId="u1" attachments={[file({ uploader: { id: 'u1', name: 'Alex', image: null } })]} />);
  expect(screen.getByRole('button', { name: /delete screenshot\.png/i })).toBeInTheDocument();
});

test('a plain member sees no delete control on somebody else’s file', async () => {
  render(<CardAttachments {...props} viewerId="u2" viewerIsOwner={false} attachments={[file()]} />);
  expect(screen.queryByRole('button', { name: /delete/i })).not.toBeInTheDocument();
});

test('the board owner sees a delete control on anybody’s file', async () => {
  render(<CardAttachments {...props} viewerId="u2" viewerIsOwner attachments={[file()]} />);
  expect(screen.getByRole('button', { name: /delete screenshot\.png/i })).toBeInTheDocument();
});

test('the board owner sees a delete control on a file whose uploader is gone', async () => {
  render(<CardAttachments {...props} viewerId="u2" viewerIsOwner attachments={[file({ uploader: null })]} />);
  expect(screen.getByRole('button', { name: /delete screenshot\.png/i })).toBeInTheDocument();
});
```

- [ ] **Step 2: Run and watch it fail**

```bash
pnpm exec vitest run components/board/card-attachments.test.tsx > /tmp/c3.log 2>&1; echo "EXIT=$?"; tail -20 /tmp/c3.log
```

Expected: FAIL — no delete button.

- [ ] **Step 3: Add the control**

The predicate mirrors the server's exactly — `file.uploader?.id === viewerId || viewerIsOwner` — and the server re-checks it regardless, because a client-side predicate is presentation, never authorisation. The delete control is destructive, so it carries `--time-over`: that is one of the two sanctioned warm uses, transient and local, inside a control the user is already looking at.

- [ ] **Step 4: Slot the section into `card-body.tsx`**

`CardBody` renders two branches — a viewer's and a writer's — and both render `CardLabels` and `CardComments`. Add `CardAttachments` to **both**, between labels and comments, passing the props through from `getCardForRoute`. Missing the viewer branch is the easy mistake here: a viewer must still see the files.

- [ ] **Step 5: Run the whole component suite and watch it pass**

```bash
pnpm exec vitest run components/board > /tmp/c3.log 2>&1; echo "EXIT=$?"; tail -20 /tmp/c3.log
```

- [ ] **Step 6: Commit**

```bash
git add components/board
git commit -m "feat: delete an attachment from the card modal"
```

---

### Task C4: Section C verification and pull request

- [ ] **Step 1: Add the end-to-end flow**

Extend `e2e/attachments.spec.ts`: attach a real file through the modal, see it listed, reload and see it still there, delete it and see it gone. Then a viewer-role session sees the file and no controls.

- [ ] **Step 2: Look at it**

A UI change needs eyes and a screenshot for the PR body. `pnpm dev`, open a card, attach a PNG and a PDF. Check: the image renders at a sane height, the mono size line reads correctly, focus rings are visible on the picker and the delete control, and the section looks right in both light and dark.

- [ ] **Step 3: Run everything**

```bash
pnpm typecheck > /tmp/tc.log 2>&1; echo "TYPECHECK=$?"
pnpm lint > /tmp/lint.log 2>&1; echo "LINT=$?"
pnpm test > /tmp/unit.log 2>&1; echo "TEST=$?"
pnpm build > /tmp/build.log 2>&1; echo "BUILD=$?"
pnpm exec playwright test --reporter=line > /tmp/e2e.log 2>&1; echo "E2E=$?"
tail -3 /tmp/e2e.log
```

`pnpm build` matters most in this section: it is the only check that catches `card-attachments.tsx` importing a value from `lib/attachments.ts`.

- [ ] **Step 4: Commit, push, open the PR** with screenshots of the modal in both themes.

---

# Section D — the card face and realtime

Two events, the board-face count, and the two-client proof. Branch `feat/attachments-realtime` from `main` once Section C has landed.

### Task D1: The two events

**Files:**
- Modify: `lib/events.ts`
- Modify: `lib/events.test.ts`
- Modify: `components/board/realtime.tsx`

**Interfaces:**
- Produces: `attachment.added` and `attachment.removed` in the `BoardEvent` union, and the same two names in `EVENT_NAMES`.

`EveryEventIsBound` in `realtime.tsx` fails `pnpm typecheck` if a member is added to the union without its name being bound; `EVENT_NAMES`'s own `satisfies` catches the reverse. `lib/events.test.ts` holds a hand-written list of nineteen names — it is a second opinion, not the guarantee, and it must move to twenty-one.

- [ ] **Step 1: Write the failing test**

In `lib/events.test.ts`, add both names to the expected list and change the count from nineteen to twenty-one.

```ts
test('every event name is bound in the client', () => {
  const names = [
    // ...the existing nineteen...
    'attachment.added',
    'attachment.removed',
  ];
  expect(names).toHaveLength(21);
  // ...the existing assertion that realtime.tsx contains each name...
});
```

- [ ] **Step 2: Run and watch it fail**

```bash
pnpm exec vitest run lib/events.test.ts > /tmp/d1.log 2>&1; echo "EXIT=$?"; tail -20 /tmp/d1.log
```

Expected: FAIL — `realtime.tsx` does not contain `attachment.added`.

- [ ] **Step 3: Add both to the union**

In `lib/events.ts`, append to `BoardEvent`:

```ts
    | {
        type: 'attachment.added';
        id: string;
        cardId: string;
        filename: string;
        contentType: string;
        size: number;
        createdAt: string;
        uploader: { id: string; name: string | null; image: string | null } | null;
      }
    | { type: 'attachment.removed'; id: string; cardId: string }
```

No truncation branch is needed. The larger of the two carries a 200-character filename and a display name, comfortably inside `PAYLOAD_CEILING`. Neither carries a URL — a client that receives one asks the download route, which is where permission is re-checked anyway.

- [ ] **Step 4: Confirm the typecheck guard actually fires**

Before binding the names, run `pnpm typecheck` and watch `EveryEventIsBound` fail. That failure is the guard doing its job; seeing it once is how you know it is real rather than assumed.

```bash
pnpm typecheck > /tmp/d1tc.log 2>&1; echo "EXIT=$?"; grep -A3 EveryEventIsBound /tmp/d1tc.log
```

- [ ] **Step 5: Bind both names in `EVENT_NAMES`**, then re-run typecheck and the test. Both pass.

- [ ] **Step 6: Commit**

```bash
git add lib/events.ts lib/events.test.ts components/board/realtime.tsx
git commit -m "feat: add the two attachment events, taking the union to twenty-one"
```

---

### Task D2: Publishing

**Files:**
- Modify: `lib/actions/attachments.ts`
- Modify: `lib/actions/attachments.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
test('confirmUpload publishes attachment.added after the row is ready', async () => {
  await confirmUpload({ attachmentId: 'a1', mutationId: 'm1' });
  expect(publish).toHaveBeenCalledWith('b1', expect.objectContaining({
    type: 'attachment.added',
    id: 'a1',
    cardId: 'c1',
    size: 1024,
    mutationId: 'm1',
    actorId: 'u1',
  }));
});

test('confirmUpload publishes the real size, not the declared one', async () => {
  headObject.mockResolvedValue({ size: 4096, contentType: 'image/png' });
  await confirmUpload({ attachmentId: 'a1', mutationId: 'm1' });
  expect(publish).toHaveBeenCalledWith('b1', expect.objectContaining({ size: 4096 }));
});

test('a rejected confirm publishes nothing', async () => {
  headObject.mockResolvedValue({ size: 20 * 1024 * 1024, contentType: 'image/png' });
  await confirmUpload({ attachmentId: 'a1', mutationId: 'm1' });
  expect(publish).not.toHaveBeenCalled();
});

test('the publish happens after the update, never before', async () => {
  // A rolled-back write that already announced itself puts every other client
  // into a state the database disagrees with.
  await confirmUpload({ attachmentId: 'a1', mutationId: 'm1' });
  expect(publishedAfter).toBe(true);
});

test('deleteAttachment publishes attachment.removed', async () => {
  await deleteAttachment({ attachmentId: 'a1', mutationId: 'm1' });
  expect(publish).toHaveBeenCalledWith('b1', expect.objectContaining({
    type: 'attachment.removed',
    id: 'a1',
    cardId: 'c1',
  }));
});
```

- [ ] **Step 2: Run and watch it fail**, then replace the two `// Section D publishes …` comments with real `publish` calls, placed after the database write and before the return. Re-run and watch them pass.

- [ ] **Step 3: Commit**

```bash
git add lib/actions/attachments.ts lib/actions/attachments.test.ts
git commit -m "feat: publish the attachment events after their writes commit"
```

---

### Task D3: The count on the card face

**Files:**
- Modify: `lib/boards.ts`
- Modify: `lib/board-state.ts`
- Modify: `lib/board-state.test.ts`
- Modify: `components/board/board-card.tsx`
- Modify: `components/board/board-card.test.tsx`

**Interfaces:**
- Produces: `BoardCardRow.attachments: { id: string }[]`, `StateCard.attachmentCount: number`, and two reducer cases — `attachment.add` and `attachment.remove`.

- [ ] **Step 1: Write the failing tests**

```ts
test('toBoardState carries the attachment count', () => {
  const state = toBoardState(boardWith({ attachments: [{ id: 'a1' }, { id: 'a2' }] }));
  expect(state.cards[0].attachmentCount).toBe(2);
});

test('attachment.add increments the count', () => {
  const next = reduce(state, { type: 'attachment.add', cardId: 'c1' });
  expect(next.cards[0].attachmentCount).toBe(1);
});

test('attachment.remove decrements it, and never below zero', () => {
  // A removal for a card whose count is already zero can arrive after a
  // reseed. Clamping is cheaper than reasoning about ordering.
  const next = reduce(state, { type: 'attachment.remove', cardId: 'c1' });
  expect(next.cards[0].attachmentCount).toBe(0);
});
```

And in `board-card.test.tsx`:

```tsx
test('shows a paperclip and a count when the card has attachments', () => {
  render(<BoardCard card={card({ attachmentCount: 3 })} />);
  expect(screen.getByLabelText('3 attachments')).toBeInTheDocument();
});

test('shows nothing when the card has none', () => {
  render(<BoardCard card={card({ attachmentCount: 0 })} />);
  expect(screen.queryByLabelText(/attachment/)).not.toBeInTheDocument();
});

test('the count carries no colour of its own', () => {
  // CLAUDE.md allows three colour roles and warm is never at rest on the
  // board except a due date. The count is muted mono, like every other meta.
  render(<BoardCard card={card({ attachmentCount: 3 })} />);
  expect(screen.getByLabelText('3 attachments')).toHaveClass('text-muted');
});
```

- [ ] **Step 2: Run and watch them fail.**

- [ ] **Step 3: Add the count to the board query**

In `lib/boards.ts`, add `attachments` to the card's `with` block, selecting only the id — the count is `length`, and pulling filenames onto the board would be paying for data no card face shows:

```ts
            with: {
              cardLabels: { columns: { labelId: true } },
              attachments: {
                columns: { id: true },
                where: (row, { eq }) => eq(row.status, 'ready'),
              },
            },
```

Add `attachmentCount: card.attachments.length` in `toBoardState`, `attachmentCount: number` to `StateCard`, and the two reducer cases. Then the paperclip in `board-card.tsx`, in the existing meta line beside the due date and the label line — muted mono, no new hue.

- [ ] **Step 4: Run and watch them pass.**

- [ ] **Step 5: Bind the events to the reducer** in `realtime.tsx`, dispatching `attachment.add` and `attachment.remove`, ignoring events the client caused itself on `mutationId` the way every other handler does.

- [ ] **Step 6: Commit**

```bash
git add lib/boards.ts lib/board-state.ts lib/board-state.test.ts components/board
git commit -m "feat: show an attachment count on the card face, live"
```

---

### Task D4: The two-client proof

**Files:**
- Modify: `e2e/attachments.spec.ts`

- [ ] **Step 1: Write the test**

Two browser contexts on one board, following the shape `e2e/labels.spec.ts` already uses. One attaches a file; the other's card face shows the count without a reload. Then the first deletes it, and the second's count goes back down.

Give the subscription time to establish before the first mutation — `e2e/members.spec.ts` was changed in a recent commit for exactly this race, so copy its wait rather than inventing one.

- [ ] **Step 2: Run it**

```bash
pnpm exec playwright test e2e/attachments.spec.ts --reporter=line > /tmp/d4.log 2>&1; echo "EXIT=$?"; tail -5 /tmp/d4.log
```

Expected: PASS, with the count that ran equal to the count collected.

- [ ] **Step 3: Commit**

```bash
git add e2e/attachments.spec.ts
git commit -m "test: prove attachments arrive on a second browser"
```

---

### Task D5: Section D verification, documentation, and the final pull request

- [ ] **Step 1: Run everything**

```bash
pnpm typecheck > /tmp/tc.log 2>&1; echo "TYPECHECK=$?"
pnpm lint > /tmp/lint.log 2>&1; echo "LINT=$?"
pnpm test > /tmp/unit.log 2>&1; echo "TEST=$?"
pnpm build > /tmp/build.log 2>&1; echo "BUILD=$?"
pnpm exec playwright test --reporter=line > /tmp/e2e.log 2>&1; echo "E2E=$?"
tail -3 /tmp/e2e.log
```

- [ ] **Step 2: Update `CLAUDE.md`**

"Realtime" — "all nineteen" becomes twenty-one, with the two names added to the list. "Open decisions" — attachments resolved, pointing at `docs/specs/attachments.md`; the activity log and board archive versus hard delete remain.

- [ ] **Step 3: Work the spec's verification list**

`docs/specs/attachments.md` "Verification" holds eleven boxes. Tick them only against observed output, and leave open the ones that genuinely need a human at two browsers rather than ticking them off a Playwright run — `docs/plans/realtime.md` has the precedent for saying so plainly.

Two are easy to skip and must not be:

```bash
# The board still works with no bucket at all.
env -u S3_ENDPOINT -u S3_BUCKET -u S3_ACCESS_KEY_ID -u S3_SECRET_ACCESS_KEY -u S3_REGION \
  pnpm build > /tmp/nobucket.log 2>&1; echo "EXIT=$?"
```

```bash
# An SVG downloads rather than rendering. Read the header, not the intent.
curl -sI -b "$COOKIE" http://localhost:3000/api/attachments/<id> | grep -i location
# then follow that URL and check its content-disposition says attachment
```

- [ ] **Step 4: Run `/superpowers:review` on the whole branch**, on Opus. The final review reads the branch against the spec, the plan and `CLAUDE.md` at once, which is where breadth pays for itself.

- [ ] **Step 5: Commit, push, open the PR**, then stop and hand back.
