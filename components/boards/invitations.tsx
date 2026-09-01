'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { acceptInvite, declineInvite } from '@/lib/actions/members';
import type { UserInvite } from '@/lib/members';

export function Invitations({ invites }: { invites: UserInvite[] }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  if (invites.length === 0) return null;

  function answer(inviteId: string, accepted: boolean) {
    setError(null);
    startTransition(async () => {
      const result = await (accepted ? acceptInvite({ inviteId }) : declineInvite({ inviteId }));
      if (!result.ok) {
        setError('That invitation is no longer open. Refresh to see what changed.');
        return;
      }
      router.refresh();
    });
  }

  return (
    <section className="mb-6 rounded-[var(--radius-card)] border border-line bg-surface p-4">
      <h2 className="text-sm font-semibold uppercase tracking-[0.08em] text-muted">Invitations</h2>
      <ul className="mt-3 space-y-3">
        {invites.map((invite) => (
          <li key={invite.id} className="flex flex-wrap items-center gap-3">
            <span className="flex-1 text-[15px]">
              {invite.invitedByName
                ? `${invite.invitedByName} invited you to ${invite.boardName} as a ${invite.role}.`
                : `You have been invited to ${invite.boardName} as a ${invite.role}.`}
            </span>
            <button
              type="button"
              disabled={pending}
              onClick={() => answer(invite.id, true)}
              className="rounded-[var(--radius-control)] bg-flow-mid px-3 py-1.5 text-sm font-medium text-white"
            >
              Accept
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() => answer(invite.id, false)}
              className="rounded-[var(--radius-control)] border border-line px-3 py-1.5 text-sm font-medium"
            >
              Decline
            </button>
          </li>
        ))}
      </ul>
      {error && <p className="mt-3 text-sm text-time-over">{error}</p>}
    </section>
  );
}
