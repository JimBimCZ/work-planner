# Spec: Auth

Status: approved, not implemented
Date: 2026-08-30
Sub-project: 2 of 7

## Goal

A signed-in application. Google and GitHub OAuth over database sessions, the
first migration in the repository's history, route protection on `/boards/*`, a
sign-in screen, and a top bar with an account menu that the next four
sub-projects extend rather than replace.

Sub-project 3 inherits a `users` table it can key membership off, and a shell it
can hang a board list inside.

## Non-goals

Boards, `board_members`, roles and `lib/permissions.ts` — all sub-project 3, and
its migration, not this one. No invite flow. No account deletion UI: the shipped
privacy policy promises deletion by email, and that stays true. No profile
editing, no linking a second provider from the menu, no presence.

`/design` stays public and unprotected. It is deleted at the close of
sub-project 4 and is not worth a session check in the meantime.

## Deliverables

### Routes

| Route | Behaviour |
|---|---|
| `/signin` | Two buttons: "Continue with Google", "Continue with GitHub". Nothing else on the screen |
| `/boards` | Requires a session. Still the "Nothing here yet" placeholder, now inside the shell |
| `/api/auth/[...nextauth]` | Auth.js `GET`/`POST` handlers |

`/` continues to redirect to `/boards`, so an unauthenticated visitor lands on
`/signin` by way of the redirect chain rather than by a second rule.

### Schema and the first migration

`lib/db/schema.ts` stops being a placeholder and gains three tables: `users`,
`accounts`, `sessions`. Indexes on `accounts(userId)` and `sessions(userId)`.

Three, not four. `DrizzleAdapter` is called with **no schema argument**, and its
`defineTables` helper then builds every table it needs from its own defaults —
so the tables we never touch, `verificationToken` (magic links) and
`authenticator` (WebAuthn), simply never have to exist in the database. Passing a
partial schema is not the way to get this: the exported `DrizzleAdapter(db,
schema)` types its second parameter as the complete `DefaultPostgresSchema`, and
only the internal `defineTables` accepts a `Partial`. Omitting the argument is
both the typed path and the smaller migration.

The cost of that choice is a naming contract: our table and column names must
match the adapter's defaults exactly — tables `user`, `account`, `session`, with
`userId`, `sessionToken`, `providerAccountId` and the rest spelled as the
adapter spells them — because the adapter builds its queries against its own
definitions, not ours. A rename here breaks every adapter query with no type
error to catch it, so a unit test pins the names.

One column still exists only because the adapter reads it: `users.emailVerified`,
which `CLAUDE.md`'s data model does not list. That is a different case from
`assigneeId` and `wipLimit` — those are our own speculation and remain due for a
decision in sub-project 3.

This migration adds auth tables only. It does not force the
`assigneeId`/`wipLimit` question early.

The migration is generated with `pnpm db:generate` and never hand-edited.

### Auth configuration

`lib/auth.ts` exports `{ handlers, auth, signIn, signOut }` from `NextAuth` with
the Drizzle adapter, `session.strategy = 'database'`, the Google and GitHub
providers, and `pages.signIn = '/signin'`.
`app/api/auth/[...nextauth]/route.ts` re-exports `GET` and `POST`.

Session lifetime stays Auth.js's 30-day default. The privacy policy claims no
cookie duration, so there is nothing for this to drift from — and if a duration
is ever published, this is the number it must match.

Accounts are **not** linked across providers. Auth.js's default refusal stands:
one identity per provider. Automatic linking on a provider-asserted email is the
documented account-takeover path — anyone who can make an OAuth provider assert
an address would inherit that person's boards — and the convenience does not pay
for it. Sub-project 3's invites key on the email column and work either way, so
nothing downstream needs the merge.

### Route protection

`proxy.ts` at the repository root. Not `middleware.ts`: Next 16 deprecates that
convention and renames it to `proxy`, and Auth.js's own Next.js documentation has
already followed.

It matches `/boards/:path*`, checks that the session cookie is present, and
redirects to `/signin?callbackUrl=...` when it is not. It imports nothing from
`lib/`, opens no database connection, and holds no shared state. Next's proxy
documentation is explicit that the file "is meant to be invoked separately of
your render code and in optimized cases deployed to your CDN" and that you
"should not attempt relying on shared modules or globals" — the pooled `db`
client in `lib/db/index.ts` is exactly such a module.

The real check is `auth()` in `app/(app)/layout.tsx`, which redirects when there
is no session. A stale or forged cookie passes the proxy and is rejected there.
This is deliberate and matches the standing rule that middleware is routing, not
authorisation: the proxy saves a wasted render, and is never the thing standing
between a stranger and anyone's data. Every server action added later
re-checks independently, as it must.

`callbackUrl` is honoured only when it is a relative path. Anything else is an
open redirect.

### Sign-in and the account-exists refusal

`app/(auth)/signin/page.tsx` is a server component. Each button is a form
posting to a server action that calls `signIn('google')` or `signIn('github')`.
The copy is fixed by `CLAUDE.md` and does not get embellished.

Naming the other provider in the refusal needs a `signIn` callback of our own.
Auth.js's built-in `OAuthAccountNotLinked` redirect carries neither the email nor
the provider, so the callback looks up any existing user with the incoming
email and the providers already attached to it. When one exists without the
incoming provider, it returns `/signin?error=account-exists&provider=google`,
and the page renders:

> That email already signs in with Google. Continue with Google instead.

with that provider's button leading. Any other error renders "Something went
wrong signing you in. Try again." — no apology, per the copy rules.

This discloses which provider owns an address, but only to someone who has
already completed an OAuth flow at that provider using that address, and who
therefore controls it. The disclosure is accepted rather than designed around.

### The `(app)` shell and account menu

`app/(app)/layout.tsx` calls `auth()`, redirects to `/signin` without a session,
and renders a top bar above its children: product name left, account menu right.
The bar is `--surface`, and stays thin on purpose — sub-project 4 adds the board
title and the "New card" action to this bar rather than inventing a second
header.

The menu is a re-tokenised shadcn dropdown (`'use client'`, Radix underneath)
holding the signed-in email, the theme control, a privacy link, and sign out.
Sign out is a server action calling `signOut`.

The avatar uses the provider's `image` when there is one. Otherwise it is the
user's initials on a hue hashed from their id into 180°-300°, per the
cool-half rule that keeps avatars from competing with the warm due-date signal.
That hash lives in `lib/avatar.ts` as a pure function with its own test, beside
`lib/flow.ts`.

`SiteFooter` continues to render from the root layout on every route, including
`/boards`, and the account menu carries the privacy link as `CLAUDE.md`
requires. When sub-project 4 locks body scroll on the board route, it drops the
footer there. Recorded as a follow-up rather than built ahead of the problem.

### Theme control

The menu offers **System / Light / Dark**, and this settles the toggle question
Foundation carried forward.

`/design`'s toggle is binary and writes `localStorage` on first click, which
pins the choice permanently — the pre-paint script's `matchMedia` fallback
becomes unreachable the moment it is used. "System" clears the stored value,
which makes that fallback reachable again. No change to the script itself.

### Testing

Unit tests target pure functions, not framework glue: the provider-conflict
resolution, the `callbackUrl` sanitiser, and the avatar hue. Each is extracted so
it can be tested without a request.

End-to-end, real OAuth is untestable in CI, and database sessions are what
rescue it. A test inserts a user and a session row over `pg` and sets the session
cookie on the browser context, producing a genuinely signed-in page with no
provider involved. This is a property a JWT strategy would not have given us.

Covered: signed-out `/boards` redirects to `/signin` carrying a `callbackUrl`; a
seeded session sees the top bar and its own email; sign out clears the session
and redirects; `?error=account-exists&provider=google` renders the named-provider
copy; the privacy link is reachable from `/boards` through the menu.

This works only because CI migrates before it tests.

### CI and migrations

CI gains `pnpm db:migrate` before the test steps. The workflow already runs a
Postgres service with both `DATABASE_URL` variables pointed at it, so every pull
request proves the migration applies to an empty database, and the end-to-end
suite runs against a real schema rather than an empty one.

Production is migrated by hand: `pnpm db:migrate` against the production branch
when a migration lands. `CLAUDE.md` currently says this "runs from CI on the
production branch before the deploy promotes", which is not true and cannot be
made true while Vercel deploys straight from a push — CI can race that promotion
but cannot gate it. The sentence is corrected rather than the setup being bent to
fit it. The exposure is a few minutes in which the deployed app expects tables
that do not exist yet; with no users, that costs nothing, and a real gate via a
deploy hook is available later if it ever does.

This supersedes the Foundation spec's line deferring a migrate-on-main workflow
to this sub-project: there is no migrate-on-main workflow, by decision.

### Documentation changes

Landing with this work, in the same pull requests: `middleware` becomes `proxy`
throughout `CLAUDE.md`, the migration sentence is corrected as above, the layout
tree gains `(auth)/signin` and `proxy.ts`, and the theme-toggle open decision is
marked resolved.

## Verification

Done when, with output observed rather than assumed:

- `pnpm typecheck && pnpm lint && pnpm test && pnpm test:e2e` all pass locally.
- A real sign-in with Google and with GitHub, against the deployed preview,
  creates one `users` row and one `accounts` row each and lands on `/boards`.
- Signing in with the second provider on an address already held by the first is
  refused, and the screen names the first provider.
- Signed out, `/boards` redirects to `/signin`; signed in, the account menu
  shows the right email and signs out cleanly.

## Open decisions carried forward

- ~~**No way to choose a different provider account at the refusal.**~~
  **Resolved 2026-08-30.** Found by the author while verifying Section D:
  signing in with Google, signing out, then choosing GitHub on the *same*
  address refused exactly as designed — but the provider had already
  auto-authenticated the remembered session, so no different account could be
  offered, and clicking through again reproduced the refusal.

  The refusal redirect now carries the attempted provider, and the screen
  offers a retry that re-runs it with `prompt=select_account`. Both providers
  document that parameter as forcing the account picker — GitHub's is on its
  authorize endpoint ("Forces the account picker to appear if set to
  `select_account`"), which corrected an earlier assumption that only Google
  could do this.

  **Accounts are still not linked**, and the reasoning below stands unchanged.
  This lets someone reach the account they meant to use; it does not join two
  identities.

  The picker itself was the one thing verification could not reach — showing the
  chooser needs a browser already signed in to the provider. The author
  confirmed it on the deployed site, 2026-08-30: the retry lands on the account
  chooser rather than re-authenticating the remembered session.

- **`assigneeId` and `wipLimit`.** ~~Due in sub-project 3.~~ **Resolved during
  Section A: both dropped.** See the data-model rules in `CLAUDE.md`.
- **Dropping `SiteFooter` on the board route.** Due in sub-project 4, when body
  scroll is locked and the footer becomes unreachable.
- **A real migration gate.** Revisit when the service has users and a few
  minutes of schema lag stops being free.

## Settled while writing the plan

These three were recorded as unknown when the spec was approved, and were then
checked against the packages themselves rather than guessed:

- **Versions.** `next-auth` has no stable v5: `latest` is 4.24.15 and v5 lives on
  the `beta` tag, currently `5.0.0-beta.32`. Its peer range is
  `next: ^14 || ^15 || ^16`, which is what `CLAUDE.md` relied on when it moved
  the project to Next 16. `@auth/drizzle-adapter` is `1.11.3` and stable. Shipping
  authentication on a beta dependency is a real risk, accepted knowingly and
  pinned to an exact version rather than a range.
- **Table count.** The adapter does not require `verificationTokens`. See the
  schema section above.
- **Cookie names.** `authjs.session-token` over HTTP and
  `__Secure-authjs.session-token` over HTTPS — `defaultCookies()` in
  `@auth/core` adds the `__Secure-` prefix whenever the site URL is HTTPS. The
  proxy checks for both, since local development is HTTP and every deployment is
  not.
- **Avatars.** `next/image` with `images.remotePatterns` for
  `lh3.googleusercontent.com` and `avatars.githubusercontent.com`. Next 16
  removed `images.domains`, and a plain `img` would trip
  `@next/next/no-img-element` in a lint run that has to stay clean.

## Sequencing with the author

Two things the agent cannot do. The Google and GitHub OAuth clients belong to
the author, and each needs callback URLs for `http://localhost:3000`, for
`https://work-planner-seven.vercel.app`, and for a stable preview alias —
`CLAUDE.md` already warns that sign-in fails on previews otherwise. The
resulting `AUTH_GOOGLE_ID`/`AUTH_GOOGLE_SECRET`, `AUTH_GITHUB_ID`/
`AUTH_GITHUB_SECRET` and `AUTH_SECRET` go into all three Vercel environments;
they are already listed in `.env.example`.

The production migration is also the author's to run, by the decision above.
