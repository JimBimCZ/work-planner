'use server';

import { eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { sharedBoardsOwnedBy } from '@/lib/account';
import { auth, signOut } from '@/lib/auth';
import { db } from '@/lib/db';
import { users } from '@/lib/db/schema';

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

  const outcome = await db.transaction(async (tx) => {
    // Re-checked inside the transaction because a client can skip the page
    // that showed the list, and because membership could change under it.
    const shared = await sharedBoardsOwnedBy(userId, tx);
    if (shared.length > 0) {
      return { ok: false, error: 'OWNS_SHARED_BOARDS', boards: shared } as const;
    }

    await tx.delete(users).where(eq(users.id, userId));
    return { ok: true } as const;
  });

  if (!outcome.ok) return outcome;

  // After the transaction commits, never inside it: the session row is already
  // gone by cascade, so this clears the cookie and nothing else.
  await signOut({ redirect: false });
  revalidatePath('/boards');
  return { ok: true } as const;
}
