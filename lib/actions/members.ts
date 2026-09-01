'use server';

import { eq } from 'drizzle-orm';
import { z } from 'zod';

import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { boardInvites } from '@/lib/db/schema';
import { assertBoardAccess, boardAccessResult } from '@/lib/permissions';

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
