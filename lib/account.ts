import { db } from '@/lib/db';
import { supportedProvider } from '@/lib/account-conflict';

export type OwnedBoard = { id: string; name: string };

type BoardRow = { id: string; name: string; members: { userId: string }[] };

// db and a drizzle transaction expose the same query shape. Taking the client
// as a parameter is what lets deleteAccount re-run this check inside the
// transaction that does the delete, rather than racing it from outside.
type BoardQuerier = {
  query: {
    boards: {
      findMany: (config: Parameters<typeof db.query.boards.findMany>[0]) => Promise<unknown>;
    };
  };
};

export async function sharedBoardsOwnedBy(
  userId: string,
  client: BoardQuerier = db,
): Promise<OwnedBoard[]> {
  const owned = (await client.query.boards.findMany({
    where: (board, { eq }) => eq(board.ownerId, userId),
    columns: { id: true, name: true },
    with: { members: { columns: { userId: true } } },
  })) as BoardRow[];

  return owned
    .filter((board) => board.members.some((member) => member.userId !== userId))
    .map(({ id, name }) => ({ id, name }));
}

export async function signInProviders(userId: string): Promise<string[]> {
  const rows = await db.query.accounts.findMany({
    where: (account, { eq }) => eq(account.userId, userId),
    columns: { provider: true },
  });

  return rows.map((row) => supportedProvider(row.provider)?.label ?? row.provider);
}
