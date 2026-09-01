import { db } from '@/lib/db';
import type { BoardRole } from '@/lib/permissions';

export const INVITE_TTL_DAYS = 30;

// Expiry is filtered at read time, not purged: Deployment forbids a scheduled
// job, and an expired row still holds its (board_id, email) pair — which is
// what makes inviteMember an upsert rather than an insert.
export function inviteCutoff(): Date {
  return new Date(Date.now() - INVITE_TTL_DAYS * 86_400_000);
}

export type BoardMemberRow = {
  userId: string;
  name: string | null;
  email: string;
  image: string | null;
  role: BoardRole;
};

export async function listMembers(boardId: string): Promise<BoardMemberRow[]> {
  const rows = await db.query.boardMembers.findMany({
    where: (member, { eq }) => eq(member.boardId, boardId),
    columns: { userId: true, role: true },
    with: { user: { columns: { name: true, email: true, image: true } } },
  });

  return rows
    .map((row) => ({
      userId: row.userId,
      role: row.role,
      name: row.user.name,
      email: row.user.email ?? '',
      image: row.user.image,
    }))
    .sort((a, b) => (a.role === 'owner' ? -1 : b.role === 'owner' ? 1 : 0));
}

export type PendingInvite = { id: string; email: string; role: BoardRole; createdAt: Date };

export async function listPendingInvites(boardId: string): Promise<PendingInvite[]> {
  return db.query.boardInvites.findMany({
    where: (invite, { and, eq, gt }) =>
      and(eq(invite.boardId, boardId), gt(invite.createdAt, inviteCutoff())),
    columns: { id: true, email: true, role: true, createdAt: true },
    orderBy: (invite, { asc }) => [asc(invite.createdAt)],
  });
}

export type UserInvite = {
  id: string;
  boardId: string;
  boardName: string;
  role: BoardRole;
  invitedByName: string | null;
};

export async function listInvitesForUser(email: string): Promise<UserInvite[]> {
  const address = email.trim().toLowerCase();
  const rows = await db.query.boardInvites.findMany({
    where: (invite, { and, eq, gt }) =>
      and(eq(invite.email, address), gt(invite.createdAt, inviteCutoff())),
    columns: { id: true, boardId: true, role: true },
    with: { board: { columns: { name: true } }, invitedBy: { columns: { name: true } } },
    orderBy: (invite, { asc }) => [asc(invite.createdAt)],
  });

  return rows.map((row) => ({
    id: row.id,
    boardId: row.boardId,
    boardName: row.board.name,
    role: row.role,
    invitedByName: row.invitedBy?.name ?? null,
  }));
}

export type FoundInvite = { id: string; boardId: string; email: string; role: BoardRole };

export async function findPendingInvite(inviteId: string): Promise<FoundInvite | null> {
  const invite = await db.query.boardInvites.findFirst({
    where: (row, { and, eq, gt }) => and(eq(row.id, inviteId), gt(row.createdAt, inviteCutoff())),
    columns: { id: true, boardId: true, email: true, role: true },
  });
  return invite ?? null;
}

export type VisibleMember = Omit<BoardMemberRow, 'email'> & { email: string | null };

// "Only the owner sees addresses" is a rule about what is sent. A dialog handed
// every address and told to render some of them has already put them in the
// props and in the network tab.
export function visibleMembers(
  members: BoardMemberRow[],
  viewerIsOwner: boolean,
): VisibleMember[] {
  return members.map((member) => ({ ...member, email: viewerIsOwner ? member.email : null }));
}
