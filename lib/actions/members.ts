'use server';

import { and, eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { boardInvites, boardMembers, boards } from '@/lib/db/schema';
import { publish } from '@/lib/events';
import { findPendingInvite } from '@/lib/members';
import { assertBoardAccess, boardAccessResult } from '@/lib/permissions';

import { recordActivity } from './scope';

const id = z.string().min(1);
const assignableRole = z.enum(['member', 'viewer']);

// Folded before validation, not after: z.email() rejects a padded address, and
// an owner pasting one out of a mail client brings the whitespace with it.
const address = z.preprocess(
  (value) => (typeof value === 'string' ? value.trim().toLowerCase() : value),
  z.email(),
);

const inviteSchema = z.object({ boardId: id, email: address, role: assignableRole });
const inviteRef = z.object({ inviteId: id });

export async function inviteMember(input: unknown) {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: 'UNAUTHENTICATED' } as const;

  const parsed = inviteSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'INVALID' } as const;

  const { boardId, email, role } = parsed.data;
  const invitedById = session.user.id;

  try {
    await assertBoardAccess(invitedById, boardId, 'owner');
  } catch (error) {
    return boardAccessResult(error);
  }

  // lower() on both sides: users.email is stored as the provider sent it and its
  // unique index is case-sensitive. ilike would say this in one operator but
  // treats _ and % as wildcards, and both are legal in an address.
  const existing = await db.query.users.findFirst({
    where: (user, { sql }) => sql`lower(${user.email}) = ${email}`,
    columns: { id: true },
  });

  if (existing) {
    const membership = await db.query.boardMembers.findFirst({
      where: (member, { and: both, eq: is }) =>
        both(is(member.boardId, boardId), is(member.userId, existing.id)),
      columns: { userId: true },
    });
    if (membership) return { ok: false, error: 'ALREADY_MEMBER' } as const;
  }

  // Upsert, not insert: an expired invite is filtered out of every read but
  // still holds the (board_id, email) pair, so an insert would collide with a
  // row nobody can see. This also renews the clock and lets the owner correct
  // a pending invite's role.
  await db
    .insert(boardInvites)
    .values({ boardId, email, role, invitedById })
    .onConflictDoUpdate({
      target: [boardInvites.boardId, boardInvites.email],
      set: { role, invitedById, createdAt: new Date() },
    });

  return { ok: true } as const;
}

export async function revokeInvite(input: unknown) {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: 'UNAUTHENTICATED' } as const;

  const parsed = inviteRef.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'INVALID' } as const;

  // No expiry filter here. An expired invite is still a row, and tidying one
  // away is exactly what this action is for.
  const invite = await db.query.boardInvites.findFirst({
    where: (row, { eq: is }) => is(row.id, parsed.data.inviteId),
    columns: { id: true, boardId: true },
  });
  if (!invite) return { ok: false, error: 'NOT_FOUND' } as const;

  try {
    await assertBoardAccess(session.user.id, invite.boardId, 'owner');
  } catch (error) {
    return boardAccessResult(error);
  }

  await db.delete(boardInvites).where(eq(boardInvites.id, invite.id));
  return { ok: true } as const;
}

// The only actions in this codebase that touch a board without a membership
// check. The invitee is not on the board yet by definition; they are scoped by
// the session's own email against the invite row, the way deleteAccount is
// scoped by the session's own user id.
async function invitedTo(inviteId: string, sessionEmail: string) {
  const invite = await findPendingInvite(inviteId);
  if (!invite) return null;
  return invite.email === sessionEmail.trim().toLowerCase() ? invite : null;
}

export async function acceptInvite(input: unknown) {
  const session = await auth();
  if (!session?.user?.id || !session.user.email) {
    return { ok: false, error: 'UNAUTHENTICATED' } as const;
  }

  const parsed = inviteRef.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'INVALID' } as const;

  const invite = await invitedTo(parsed.data.inviteId, session.user.email);
  // One answer for "no such invite", "expired" and "addressed to someone else".
  if (!invite) return { ok: false, error: 'NOT_FOUND' } as const;

  const userId = session.user.id;
  await db.transaction(async (tx) => {
    // Already a member is the end state the user asked for, so it is not an
    // error; the invite is consumed either way.
    await tx
      .insert(boardMembers)
      .values({ boardId: invite.boardId, userId, role: invite.role })
      .onConflictDoNothing();
    await tx.delete(boardInvites).where(eq(boardInvites.id, invite.id));

    await recordActivity(tx, {
      boardId: invite.boardId,
      actorId: userId,
      type: 'member.joined',
      subjectId: userId,
    });
  });

  // Generated here rather than taken from the client: /boards has no
  // RealtimeProvider to claim an id from, and the accepting user is not
  // subscribed to this board's channel yet, so there is no echo to suppress.
  await publish(invite.boardId, {
    type: 'member.added',
    userId,
    role: invite.role,
    mutationId: crypto.randomUUID(),
    actorId: userId,
  });

  revalidatePath('/boards');
  return { ok: true, data: { boardId: invite.boardId } } as const;
}

export async function declineInvite(input: unknown) {
  const session = await auth();
  if (!session?.user?.id || !session.user.email) {
    return { ok: false, error: 'UNAUTHENTICATED' } as const;
  }

  const parsed = inviteRef.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'INVALID' } as const;

  const invite = await invitedTo(parsed.data.inviteId, session.user.email);
  if (!invite) return { ok: false, error: 'NOT_FOUND' } as const;

  await db.delete(boardInvites).where(eq(boardInvites.id, invite.id));
  revalidatePath('/boards');
  return { ok: true } as const;
}

const mutationId = z.string().min(1);
const memberRef = z.object({ boardId: id, userId: id, mutationId });
const roleSchema = memberRef.extend({ role: assignableRole });
const boardRef = z.object({ boardId: id, mutationId });

async function targetMembership(boardId: string, userId: string) {
  return db.query.boardMembers.findFirst({
    where: (member, { and: both, eq: is }) =>
      both(is(member.boardId, boardId), is(member.userId, userId)),
    columns: { role: true },
  });
}

export async function changeRole(input: unknown) {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: 'UNAUTHENTICATED' } as const;

  const parsed = roleSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'INVALID' } as const;

  const { boardId, userId, role } = parsed.data;
  try {
    await assertBoardAccess(session.user.id, boardId, 'owner');
  } catch (error) {
    return boardAccessResult(error);
  }

  const membership = await targetMembership(boardId, userId);
  if (!membership) return { ok: false, error: 'NOT_FOUND' } as const;
  if (membership.role === 'owner') return { ok: false, error: 'TARGET_IS_OWNER' } as const;

  const actorId = session.user.id;
  await db.transaction(async (tx) => {
    await tx
      .update(boardMembers)
      .set({ role })
      .where(and(eq(boardMembers.boardId, boardId), eq(boardMembers.userId, userId)));

    await recordActivity(tx, {
      boardId,
      actorId,
      type: 'member.role_changed',
      subjectId: userId,
      detail: role,
    });
  });

  await publish(boardId, {
    type: 'member.updated',
    userId,
    role,
    mutationId: parsed.data.mutationId,
    actorId,
  });

  revalidatePath('/boards');
  return { ok: true } as const;
}

export async function removeMember(input: unknown) {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: 'UNAUTHENTICATED' } as const;

  const parsed = memberRef.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'INVALID' } as const;

  const { boardId, userId } = parsed.data;
  try {
    await assertBoardAccess(session.user.id, boardId, 'owner');
  } catch (error) {
    return boardAccessResult(error);
  }

  const membership = await targetMembership(boardId, userId);
  if (!membership) return { ok: false, error: 'NOT_FOUND' } as const;
  if (membership.role === 'owner') return { ok: false, error: 'TARGET_IS_OWNER' } as const;

  const actorId = session.user.id;
  await db.transaction(async (tx) => {
    await tx
      .delete(boardMembers)
      .where(and(eq(boardMembers.boardId, boardId), eq(boardMembers.userId, userId)));

    await recordActivity(tx, { boardId, actorId, type: 'member.removed', subjectId: userId });
  });

  await publish(boardId, {
    type: 'member.removed',
    userId,
    mutationId: parsed.data.mutationId,
    actorId,
  });

  revalidatePath('/boards');
  return { ok: true } as const;
}

export async function leaveBoard(input: unknown) {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: 'UNAUTHENTICATED' } as const;

  const parsed = boardRef.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'INVALID' } as const;

  const { boardId } = parsed.data;
  const userId = session.user.id;

  let role;
  try {
    role = await assertBoardAccess(userId, boardId, 'viewer');
  } catch (error) {
    return boardAccessResult(error);
  }

  if (role === 'owner') return { ok: false, error: 'OWNER_CANNOT_LEAVE' } as const;

  await db.transaction(async (tx) => {
    await tx
      .delete(boardMembers)
      .where(and(eq(boardMembers.boardId, boardId), eq(boardMembers.userId, userId)));

    await recordActivity(tx, { boardId, actorId: userId, type: 'member.left', subjectId: userId });
  });

  await publish(boardId, {
    type: 'member.removed',
    userId,
    mutationId: parsed.data.mutationId,
    actorId: userId,
  });

  revalidatePath('/boards');
  return { ok: true } as const;
}

const transferSchema = memberRef.extend({ confirmName: z.string() });

export async function transferOwnership(input: unknown) {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: 'UNAUTHENTICATED' } as const;

  const parsed = transferSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'INVALID' } as const;

  const { boardId, userId, confirmName } = parsed.data;
  const previousOwnerId = session.user.id;

  try {
    await assertBoardAccess(previousOwnerId, boardId, 'owner');
  } catch (error) {
    return boardAccessResult(error);
  }

  // Re-checked here because a client can skip the dialog that asked for it.
  const board = await db.query.boards.findFirst({
    where: (row, { eq: is }) => is(row.id, boardId),
    columns: { name: true },
  });
  if (!board || board.name !== confirmName.trim()) {
    return { ok: false, error: 'NAME_MISMATCH' } as const;
  }

  const membership = await targetMembership(boardId, userId);
  if (!membership) return { ok: false, error: 'NOT_A_MEMBER' } as const;
  if (membership.role === 'owner') return { ok: false, error: 'TARGET_IS_OWNER' } as const;

  await db.transaction(async (tx) => {
    await tx.update(boards).set({ ownerId: userId }).where(eq(boards.id, boardId));
    await tx
      .update(boardMembers)
      .set({ role: 'owner' })
      .where(and(eq(boardMembers.boardId, boardId), eq(boardMembers.userId, userId)));
    await tx
      .update(boardMembers)
      .set({ role: 'member' })
      .where(and(eq(boardMembers.boardId, boardId), eq(boardMembers.userId, previousOwnerId)));

    await recordActivity(tx, {
      boardId,
      actorId: previousOwnerId,
      type: 'member.ownership_transferred',
      subjectId: userId,
    });
  });

  // Two rows moved, so the board hears about both rather than gaining a
  // fourth event for a case member.updated already describes.
  await publish(boardId, {
    type: 'member.updated',
    userId,
    role: 'owner',
    mutationId: parsed.data.mutationId,
    actorId: previousOwnerId,
  });
  await publish(boardId, {
    type: 'member.updated',
    userId: previousOwnerId,
    role: 'member',
    mutationId: parsed.data.mutationId,
    actorId: previousOwnerId,
  });

  revalidatePath('/boards');
  return { ok: true } as const;
}
