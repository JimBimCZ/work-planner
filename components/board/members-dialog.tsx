'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { Dialog, DialogContent, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import {
  changeRole,
  inviteMember,
  leaveBoard,
  removeMember,
  revokeInvite,
  transferOwnership,
} from '@/lib/actions/members';
import { attempt } from '@/lib/attempt';
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
export function MembersPanel({
  boardId,
  boardName,
  viewerId,
  isOwner,
  members,
  invites,
}: MembersProps) {
  const [error, setError] = useState<string | null>(null);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<'member' | 'viewer'>('member');
  const [handingTo, setHandingTo] = useState<string | null>(null);
  const [confirmName, setConfirmName] = useState('');
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function leave() {
    startTransition(async () => {
      const result = await attempt(() => leaveBoard({ boardId }));
      if (!result.ok) {
        setError('You could not be taken off this board. Try again.');
        return;
      }
      router.push('/boards');
    });
  }

  function invite(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await attempt(() => inviteMember({ boardId, email, role }));
      if (!result.ok) {
        setError(
          result.error === 'ALREADY_MEMBER'
            ? 'They are already on this board.'
            : 'That invite could not be sent. Check the address and try again.',
        );
        return;
      }
      setEmail('');
      router.refresh();
    });
  }

  function setMemberRole(userId: string, next: 'member' | 'viewer') {
    startTransition(async () => {
      const result = await attempt(() => changeRole({ boardId, userId, role: next }));
      if (!result.ok) {
        setError('That role could not be changed. Try again.');
        return;
      }
      router.refresh();
    });
  }

  function remove(userId: string) {
    startTransition(async () => {
      const result = await attempt(() => removeMember({ boardId, userId }));
      if (!result.ok) {
        setError('They could not be removed. Try again.');
        return;
      }
      router.refresh();
    });
  }

  function transfer(userId: string) {
    setError(null);
    startTransition(async () => {
      const result = await attempt(() => transferOwnership({ boardId, userId, confirmName }));
      if (!result.ok) {
        setError(
          result.error === 'NAME_MISMATCH'
            ? `Type ${boardName} exactly to hand the board over.`
            : 'The board could not be handed over. Try again.',
        );
        return;
      }
      setHandingTo(null);
      setConfirmName('');
      router.refresh();
    });
  }

  function revoke(inviteId: string) {
    startTransition(async () => {
      const result = await attempt(() => revokeInvite({ inviteId }));
      if (!result.ok) {
        setError('That invite could not be withdrawn. Try again.');
        return;
      }
      router.refresh();
    });
  }

  return (
    <>
      <ul className="mt-4 space-y-2">
        {members.map((member) => (
          <li key={member.userId} className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span
              aria-hidden
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-medium text-white"
              style={{ background: `hsl(${avatarHue(member.userId)} 45% 40%)` }}
            >
              {initials(member.name, member.email ?? '')}
            </span>
            <span className="min-w-0 flex-1 truncate text-sm">
              {member.name ?? member.email ?? 'Someone'}
              {member.userId === viewerId && <span className="ml-2 text-xs text-muted">You</span>}
            </span>
            {member.email && (
              <span className="min-w-0 max-w-full truncate text-xs text-muted">{member.email}</span>
            )}
            {isOwner && member.role !== 'owner' ? (
              <>
                <select
                  aria-label={`Role for ${member.name ?? member.email ?? 'this member'}`}
                  value={member.role}
                  onChange={(event) =>
                    setMemberRole(member.userId, event.target.value === 'viewer' ? 'viewer' : 'member')
                  }
                  className="shrink-0 rounded-[var(--radius-control)] border border-line bg-canvas px-2 py-1 text-xs"
                >
                  <option value="member">Member</option>
                  <option value="viewer">Viewer</option>
                </select>
                <button
                  type="button"
                  onClick={() => setHandingTo(member.userId)}
                  className="shrink-0 text-xs font-medium"
                >
                  Make owner
                </button>
                <button
                  type="button"
                  onClick={() => remove(member.userId)}
                  className="shrink-0 text-xs font-medium text-time-over"
                >
                  Remove
                </button>
              </>
            ) : (
              <span className="font-mono text-xs text-muted">{member.role}</span>
            )}
          </li>
        ))}
      </ul>
      {handingTo && (
        <div className="mt-4 rounded-[var(--radius-control)] border border-line p-3">
          <p className="text-sm">
            They become the owner and you become a member. Type <strong>{boardName}</strong> to
            confirm.
          </p>
          <input
            aria-label="Board name"
            value={confirmName}
            onChange={(event) => setConfirmName(event.target.value)}
            className="mt-2 w-full rounded-[var(--radius-control)] border border-line bg-canvas px-3 py-2 text-[15px]"
          />
          <button
            type="button"
            onClick={() => transfer(handingTo)}
            disabled={pending}
            className="mt-2 rounded-[var(--radius-control)] px-3 py-1.5 text-sm font-medium text-time-over"
          >
            Hand over the board
          </button>
        </div>
      )}
      {error && <p className="mt-3 text-sm text-time-over">{error}</p>}
      {isOwner && (
        <>
          <form onSubmit={invite} className="mt-5 space-y-2">
            <label className="block text-sm text-muted" htmlFor="invite-email">
              Invite by email
            </label>
            <div className="flex flex-wrap gap-2">
              <input
                id="invite-email"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                className="min-w-0 flex-1 rounded-[var(--radius-control)] border border-line bg-canvas px-3 py-2 text-[15px]"
              />
              <select
                aria-label="Role"
                value={role}
                onChange={(event) => setRole(event.target.value === 'viewer' ? 'viewer' : 'member')}
                className="shrink-0 rounded-[var(--radius-control)] border border-line bg-canvas px-2 text-sm"
              >
                <option value="member">Member</option>
                <option value="viewer">Viewer</option>
              </select>
              <button
                type="submit"
                disabled={pending}
                className="shrink-0 rounded-[var(--radius-control)] bg-flow-mid px-3 py-1.5 text-sm font-medium text-white"
              >
                Send invite
              </button>
            </div>
          </form>
          {invites.length > 0 && (
            <ul className="mt-4 space-y-2 border-t border-line pt-3">
              {invites.map((invite) => (
                <li key={invite.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                  <span className="min-w-0 flex-1 truncate">{invite.email}</span>
                  <span className="shrink-0 font-mono text-xs text-muted">
                    invited as {invite.role}
                  </span>
                  <button
                    type="button"
                    onClick={() => revoke(invite.id)}
                    className="shrink-0 text-xs font-medium text-time-over"
                  >
                    Revoke
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
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
