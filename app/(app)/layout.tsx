import { redirect } from 'next/navigation';
import { TopBar } from '@/components/app/top-bar';
import { auth } from '@/lib/auth';

// The real authorisation boundary. proxy.ts only spares us a wasted render.
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user) redirect('/signin');

  return (
    <div className="flex min-h-screen flex-col">
      <TopBar
        userId={session.user.id ?? ''}
        name={session.user.name ?? null}
        email={session.user.email ?? ''}
        image={session.user.image ?? null}
      />
      <div className="flex flex-1 flex-col">{children}</div>
    </div>
  );
}
