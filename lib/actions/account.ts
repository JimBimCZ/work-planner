'use server';

import { eq, sql } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { sharedBoardsOwnedBy } from '@/lib/account';
import { auth, signOut } from '@/lib/auth';
import { db } from '@/lib/db';
import { attachments, boardInvites, boards, users } from '@/lib/db/schema';
import { forgetObjects } from '@/lib/storage';

const schema = z.object({ confirmEmail: z.string() });

export async function deleteAccount(input: unknown) {
  const session = await auth();
  if (!session?.user?.id || !session.user.email) {
    return { ok: false, error: 'UNAUTHENTICATED' } as const;
  }

  const parsed = schema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'INVALID' } as const;

  const userId = session.user.id;
  const typed = parsed.data.confirmEmail.trim().toLowerCase();
  if (typed !== session.user.email.toLowerCase()) {
    return { ok: false, error: 'EMAIL_MISMATCH' } as const;
  }

  // Scoped to boards this user OWNS, never to rows they merely uploaded: a
  // file on somebody else's board keeps its bytes and loses its uploader,
  // which is what /privacy's retention section promises. Read before the
  // transaction, because the boards cascade away with the user row.
  const keys = await db
    .select({ key: attachments.key })
    .from(attachments)
    .innerJoin(boards, eq(attachments.boardId, boards.id))
    .where(eq(boards.ownerId, userId));

  const outcome = await db.transaction(async (tx) => {
    // Re-checked inside the transaction because a client can skip the page
    // that showed the list, and because membership could change under it.
    const shared = await sharedBoardsOwnedBy(userId, tx);
    if (shared.length > 0) {
      return { ok: false, error: 'OWNS_SHARED_BOARDS', boards: shared } as const;
    }

    // board_invites keys on an address, not a user id, so no foreign key removes
    // these. An invite left behind would keep an email address alive after the
    // account it names is gone.
    await tx.delete(boardInvites).where(sql`lower(${boardInvites.email}) = ${typed}`);
    await tx.delete(users).where(eq(users.id, userId));
    return { ok: true } as const;
  });

  if (!outcome.ok) return outcome;

  await forgetObjects(keys.map((row) => row.key));

  // After the transaction commits, never inside it: the session row is already
  // gone by cascade, so this clears the cookie and nothing else.
  await signOut({ redirect: false });
  revalidatePath('/boards');
  return { ok: true } as const;
}
