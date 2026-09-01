import { MembersDialog } from '@/components/board/members-dialog';
import { listMembers, listPendingInvites, visibleMembers } from '@/lib/members';
import type { BoardRole } from '@/lib/permissions';

export async function MembersButton({
  boardId,
  boardName,
  viewerId,
  role,
}: {
  boardId: string;
  boardName: string;
  viewerId: string;
  role: BoardRole;
}) {
  const isOwner = role === 'owner';
  const members = visibleMembers(await listMembers(boardId), isOwner);
  const invites = isOwner ? await listPendingInvites(boardId) : [];

  return (
    <MembersDialog
      boardId={boardId}
      boardName={boardName}
      viewerId={viewerId}
      isOwner={isOwner}
      members={members}
      invites={invites}
    />
  );
}
