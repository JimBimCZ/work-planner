'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { Dialog, DialogContent, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { leaveBoard } from '@/lib/actions/members';
import { avatarHue, initials } from '@/lib/avatar';
import type { PendingInvite, VisibleMember } from '@/lib/members';

type MembersProps = {
  boardId: string;
  boardName: string;
  viewerId: string;
  isOwner: boolean;
  members: VisibleMember[];
  invites: PendingInvite[];
};

// Split from the Dialog shell so the panel can be rendered and asserted on
// directly. Radix renders nothing but its trigger while the dialog is closed,
// which would let every "does not offer" test pass against an empty string.
export function MembersPanel({ boardId, viewerId, isOwner, members }: MembersProps) {
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const router = useRouter();

  function leave() {
    startTransition(async () => {
      const result = await leaveBoard({ boardId });
      if (!result.ok) {
        setError('You could not be taken off this board. Try again.');
        return;
      }
      router.push('/boards');
    });
  }

  return (
    <>
      <ul className="mt-4 space-y-2">
        {members.map((member) => (
          <li key={member.userId} className="flex items-center gap-3">
            <span
              aria-hidden
              className="flex h-7 w-7 items-center justify-center rounded-full text-xs font-medium text-white"
              style={{ background: `hsl(${avatarHue(member.userId)} 45% 40%)` }}
            >
              {initials(member.name, member.email ?? '')}
            </span>
            <span className="flex-1 text-sm">
              {member.name ?? member.email ?? 'Someone'}
              {member.userId === viewerId && <span className="ml-2 text-xs text-muted">You</span>}
            </span>
            {member.email && <span className="text-xs text-muted">{member.email}</span>}
            <span className="font-mono text-xs text-muted">{member.role}</span>
          </li>
        ))}
      </ul>
      {error && <p className="mt-3 text-sm text-time-over">{error}</p>}
      {!isOwner && (
        <button
          type="button"
          onClick={leave}
          className="mt-5 rounded-[var(--radius-control)] border border-line px-3 py-1.5 text-sm font-medium text-time-over"
        >
          Leave board
        </button>
      )}
    </>
  );
}

export function MembersDialog(props: MembersProps) {
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger className="rounded-[var(--radius-control)] border border-line px-3 py-1.5 text-sm font-medium">
        Members
      </DialogTrigger>
      <DialogContent>
        <DialogTitle>Members</DialogTitle>
        <MembersPanel {...props} />
      </DialogContent>
    </Dialog>
  );
}
