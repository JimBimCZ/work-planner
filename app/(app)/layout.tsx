import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';

// The real authorisation boundary. proxy.ts only spares us a wasted render.
// Each group renders its own TopBar: the board needs a title in it, and the
// two groups manage height differently.
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user) redirect('/signin');

  return children;
}
