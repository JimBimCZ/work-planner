import { rendersInline } from '@/lib/attachments-limits';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { assertBoardAccess } from '@/lib/permissions';
import { presignGet } from '@/lib/storage';

// Everything that goes wrong answers 404, including "you may not". A 403 would
// confirm a guessed id names a real file.
const notFound = () => new Response('Not found', { status: 404 });

export async function GET(
  _request: Request,
  context: { params: Promise<{ attachmentId: string }> },
) {
  const session = await auth();
  if (!session?.user?.id) return notFound();

  const { attachmentId } = await context.params;

  const row = await db.query.attachments.findFirst({
    where: (a, { and, eq }) => and(eq(a.id, attachmentId), eq(a.status, 'ready')),
    columns: { boardId: true, key: true, filename: true, contentType: true },
  });
  if (!row) return notFound();

  try {
    // A viewer may read: seeing the card is seeing its files. The check runs on
    // every request, so a removed member's next request fails — which is why
    // this route exists instead of handing out presigned URLs directly.
    await assertBoardAccess(session.user.id, row.boardId, 'viewer');
  } catch {
    return notFound();
  }

  const url = await presignGet(row.key, row.filename, rendersInline(row.contentType));

  return new Response(null, {
    status: 302,
    headers: {
      location: url,
      // Never cache the redirect: that would extend revocation from seconds to
      // minutes. presignGet's signing window is what saves the operations.
      'cache-control': 'private, no-store',
    },
  });
}
