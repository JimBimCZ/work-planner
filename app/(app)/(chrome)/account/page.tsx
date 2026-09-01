import { redirect } from 'next/navigation';

import { DeleteAccount } from '@/components/app/delete-account';
import { sharedBoardsOwnedBy, signInProviders } from '@/lib/account';
import { auth } from '@/lib/auth';

export default async function AccountPage() {
  const session = await auth();
  if (!session?.user?.id || !session.user.email) redirect('/signin');

  const [providers, blockedBoards] = await Promise.all([
    signInProviders(session.user.id),
    sharedBoardsOwnedBy(session.user.id),
  ]);

  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-8">
      <h1 className="text-[22px] font-medium tracking-tight">Account</h1>

      <dl className="mt-6 grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-[15px]">
        <dt className="text-muted">Name</dt>
        <dd>{session.user.name ?? '—'}</dd>
        <dt className="text-muted">Email</dt>
        <dd className="font-mono text-sm">{session.user.email}</dd>
        <dt className="text-muted">Sign-in</dt>
        <dd>{providers.length > 0 ? providers.join(', ') : '—'}</dd>
      </dl>

      <DeleteAccount email={session.user.email} blockedBoards={blockedBoards} />
    </main>
  );
}
