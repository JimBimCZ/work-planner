'use client';

import Link from 'next/link';
import { useState, useTransition } from 'react';

import type { OwnedBoard } from '@/lib/account';
import { deleteAccount } from '@/lib/actions/account';
import { attempt } from '@/lib/attempt';

export function DeleteAccount({
  email,
  blockedBoards,
}: {
  email: string;
  blockedBoards: OwnedBoard[];
}) {
  const [confirmEmail, setConfirmEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function remove(event: React.FormEvent) {
    event.preventDefault();
    startTransition(async () => {
      const result = await attempt(() => deleteAccount({ confirmEmail }));
      if (!result.ok) {
        setError(
          result.error === 'EMAIL_MISMATCH'
            ? 'That is not your email address. Type it exactly to delete your account.'
            : result.error === 'OWNS_SHARED_BOARDS'
              ? 'Delete the boards listed above, or hand each one to a member from its members dialog, first.'
              : 'Your account could not be deleted. Try again.',
        );
        return;
      }
      // A hard navigation, not router.push: the session is gone and every
      // cached RSC payload in this tab was rendered for a user who no longer
      // exists.
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- a router push would keep that cache.
      window.location.assign('/signin');
    });
  }

  return (
    <section className="mt-10 rounded-[var(--radius-card)] border border-line bg-surface p-5">
      <h2 className="text-xs font-semibold uppercase tracking-[0.08em] text-muted">
        Delete account
      </h2>

      <ul className="mt-3 list-disc space-y-1 pl-5 text-[15px]/6">
        <li>The boards you own go, with every column, card and comment on them.</li>
        <li>
          Your comments and any files you attached on other people&rsquo;s boards stay, without
          your name on them.
        </li>
        <li>
          If you want those removed too, ask before you delete — afterwards nothing links them to
          you, so the request cannot be honoured.
        </li>
        <li>It cannot be undone.</li>
      </ul>

      {blockedBoards.length > 0 ? (
        <div className="mt-4">
          <p className="text-[15px]/6">
            You own boards that other people are on. Delete them, or hand each one to a member from
            its members dialog, and your account can go with them.
          </p>
          <ul className="mt-2 space-y-1">
            {blockedBoards.map((board) => (
              <li key={board.id}>
                <Link href={`/boards/${board.id}`} className="text-flow-mid hover:underline">
                  {board.name}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <form onSubmit={remove} className="mt-4 space-y-3">
          <label className="block text-sm text-muted" htmlFor="confirm-email">
            Type {email} to confirm
          </label>
          <input
            id="confirm-email"
            value={confirmEmail}
            onChange={(event) => setConfirmEmail(event.target.value)}
            autoComplete="off"
            className="w-full rounded-[var(--radius-control)] border border-line bg-canvas px-3 py-2 text-[15px]"
          />
          {error && <p className="text-sm text-time-over">{error}</p>}
          <button
            type="submit"
            disabled={pending || confirmEmail.length === 0}
            className="rounded-[var(--radius-control)] bg-time-over px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
          >
            Delete account
          </button>
        </form>
      )}
    </section>
  );
}
